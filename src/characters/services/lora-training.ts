/**
 * @module LoRA 학습 서비스
 * @description ComfyUI FluxTrainer 기반 LoRA 학습, 진행률 모니터링,
 *              체크포인트 관리, 추론 테스트, 체크포인트 선택을 처리한다.
 *
 * ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌───────────┐
 * │ Training │→ │ ComfyUI   │→ │ Checkpoint │→ │ Inference │
 * │ Start    │  │ Flux      │  │ DB 저장    │  │ Test      │
 * └──────────┘  └───────────┘  └────────────┘  └───────────┘
 *
 * @dependencies comfyui, db, lora-dataset, file-utils
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';
import { comfyuiClient } from '../../comfyui/client';
import {
  buildLoraTrainWorkflow,
  buildLoraInferenceWorkflow,
} from '../../comfyui/workflows/lora-workflows';
import { getConnection } from '../../db/connection';
import {
  INSERT_TRAINING_JOB,
  GET_TRAINING_JOB,
  UPDATE_TRAINING_STATUS,
  UPDATE_TRAINING_PROGRESS,
  INSERT_CHECKPOINT,
  LIST_CHECKPOINTS,
  GET_CHECKPOINT,
  SELECT_CHECKPOINT,
  INSERT_TEST_IMAGE,
  UPDATE_CHARACTER_LORA,
} from '../../db/queries/lora-queries';
import type { TrainingJobRow, CheckpointRow } from '../../db/queries/lora-queries';
import { DEFAULT_TRAINING_CONFIG, TEST_PROMPTS } from '../types/lora.types';
import type { LoraTrainingConfig } from '../types/lora.types';
import { listDatasetImages } from './lora-dataset';
import { config } from '../../config';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { logger } from '../../common/logger';

export const trainingEvents = new EventEmitter();
trainingEvents.setMaxListeners(50);

// ─── 헬퍼 ──────────────────────────────────────────────

async function execSql(sql: string, binds: Record<string, unknown>): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(sql, binds);
    await conn.commit();
  } finally {
    await conn.close();
  }
}

async function queryOne<T>(sql: string, binds: Record<string, unknown>): Promise<T | null> {
  const conn = await getConnection();
  try {
    const r = await conn.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return r.rows?.[0] ?? null;
  } finally {
    await conn.close();
  }
}

async function downloadComfyImage(img: {
  filename: string;
  subfolder?: string;
  type?: string;
}): Promise<Buffer> {
  const url = `${config.comfyui.httpUrl}/view?filename=${img.filename}&subfolder=${img.subfolder ?? ''}&type=${img.type ?? 'output'}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function registerCheckpoints(
  jobId: string,
  outputName: string,
  cfg: LoraTrainingConfig,
): Promise<void> {
  const conn = await getConnection();
  try {
    for (let s = cfg.saveEveryNSteps; s <= cfg.maxTrainSteps; s += cfg.saveEveryNSteps) {
      const fileName = `${outputName}_${String(s).padStart(6, '0')}.safetensors`;
      await conn.execute(INSERT_CHECKPOINT, {
        checkpointId: randomUUID(),
        jobId,
        stepNumber: s,
        fileName,
      });
    }
    await conn.commit();
  } finally {
    await conn.close();
  }
}

// ─── 학습 시작 ─────────────────────────────────────────

export async function startTraining(
  charId: string,
  datasetId: string,
  userConfig?: Partial<LoraTrainingConfig>,
): Promise<string> {
  const jobId = randomUUID();
  const merged: LoraTrainingConfig = { ...DEFAULT_TRAINING_CONFIG, ...userConfig };
  await execSql(INSERT_TRAINING_JOB, {
    jobId,
    datasetId,
    charId,
    status: 'queued',
    config: JSON.stringify(merged),
    totalSteps: merged.maxTrainSteps,
  });
  executeTraining(jobId, charId, datasetId, merged).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('학습 실행 실패', { jobId, error: msg });
    execSql(UPDATE_TRAINING_STATUS, { jobId, status: 'failed', errorMessage: msg }).catch(() => {});
  });
  logger.info('학습 작업 생성', { jobId, charId, datasetId });
  return jobId;
}

// ─── 학습 실행 (private) ──────────────────────────────

async function executeTraining(
  jobId: string,
  charId: string,
  datasetId: string,
  cfg: LoraTrainingConfig,
): Promise<void> {
  const images = await listDatasetImages(datasetId);
  if (images.length === 0) throw new Error('데이터셋에 이미지가 없습니다');
  await comfyuiClient.connect();
  for (const img of images) await comfyuiClient.uploadImage(img.IMAGE_PATH);

  await execSql(UPDATE_TRAINING_STATUS, { jobId, status: 'training', errorMessage: null });
  const outputName = `lora_${charId}_${jobId.slice(0, 8)}`;
  const workflow = buildLoraTrainWorkflow({
    config: cfg,
    datasetPath: `input/${datasetId}`,
    outputDir: 'models/loras',
    outputName,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  comfyuiClient.onProgress((update): void => {
    if (update.data.prompt_id !== promptId || update.type !== 'progress') return;
    const step = update.data.value ?? 0;
    trainingEvents.emit(`train:${jobId}`, { jobId, step, total: cfg.maxTrainSteps });
    execSql(UPDATE_TRAINING_PROGRESS, { jobId, currentStep: step }).catch(() => {});
  });
  await comfyuiClient.waitForResult(promptId, 3_600_000);
  await registerCheckpoints(jobId, outputName, cfg);
  await execSql(UPDATE_TRAINING_STATUS, { jobId, status: 'completed', errorMessage: null });
  trainingEvents.emit(`train:${jobId}`, {
    jobId,
    step: cfg.maxTrainSteps,
    total: cfg.maxTrainSteps,
    status: 'completed',
  });
  logger.info('학습 완료', { jobId, charId });
}

// ─── 조회 ──────────────────────────────────────────────

export async function getTrainingJob(jobId: string): Promise<TrainingJobRow | null> {
  return queryOne<TrainingJobRow>(GET_TRAINING_JOB, { jobId });
}

export async function listCheckpoints(jobId: string): Promise<CheckpointRow[]> {
  const conn = await getConnection();
  try {
    const r = await conn.execute<CheckpointRow>(
      LIST_CHECKPOINTS,
      { jobId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  } finally {
    await conn.close();
  }
}

// ─── 체크포인트 추론 테스트 ────────────────────────────

async function runSingleTest(
  checkpointId: string,
  fileName: string,
  prompt: string,
  seed: number,
  strength: number,
  outDir: string,
): Promise<void> {
  const wf = buildLoraInferenceWorkflow({
    loraFileName: fileName,
    prompt,
    seed,
    loraStrength: strength,
  });
  const pid = await comfyuiClient.submitWorkflow(wf);
  const results = await comfyuiClient.waitForResult(pid, 120_000);
  if (results.length === 0) return;
  const imgBuf = await downloadComfyImage(results[0]);
  const imgPath = path.join(outDir, `test_${checkpointId.slice(0, 8)}_s${seed}.png`);
  await writeFileBuffer(imgPath, imgBuf);
  await execSql(INSERT_TEST_IMAGE, {
    testImageId: randomUUID(),
    checkpointId,
    promptText: prompt,
    seed,
    loraStrength: strength,
    imagePath: imgPath,
  });
}

export async function testCheckpoint(
  charId: string,
  checkpointId: string,
  triggerWord: string,
  loraStrength?: number,
): Promise<void> {
  const row = await queryOne<CheckpointRow>(GET_CHECKPOINT, { checkpointId });
  if (!row) throw new Error(`체크포인트를 찾을 수 없음: ${checkpointId}`);
  const strength = loraStrength ?? 0.7;
  const outDir = path.resolve('exports', 'lora_tests', charId);
  await ensureDir(outDir);
  await comfyuiClient.connect();
  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const prompt = `${triggerWord}, ${TEST_PROMPTS[i]}`;
    trainingEvents.emit(`test:${checkpointId}`, {
      checkpointId,
      current: i + 1,
      total: TEST_PROMPTS.length,
      prompt,
    });
    await runSingleTest(checkpointId, row.FILE_NAME, prompt, 42 + i, strength, outDir);
    logger.debug('추론 테스트 완료', { checkpointId, seed: 42 + i });
  }
  trainingEvents.emit(`test:${checkpointId}`, {
    checkpointId,
    current: TEST_PROMPTS.length,
    total: TEST_PROMPTS.length,
    status: 'completed',
  });
  logger.info('체크포인트 추론 테스트 완료', { checkpointId, charId });
}

// ─── 체크포인트 선택 ──────────────────────────────────

export async function selectCheckpoint(
  charId: string,
  jobId: string,
  checkpointId: string,
): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(SELECT_CHECKPOINT, { checkpointId, jobId });
    const r = await conn.execute<CheckpointRow>(
      GET_CHECKPOINT,
      { checkpointId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) throw new Error(`체크포인트를 찾을 수 없음: ${checkpointId}`);
    await conn.execute(UPDATE_CHARACTER_LORA, { charId, loraPath: row.FILE_NAME });
    await conn.commit();
    logger.info('체크포인트 선택 완료', { charId, jobId, checkpointId, fileName: row.FILE_NAME });
  } finally {
    await conn.close();
  }
}
