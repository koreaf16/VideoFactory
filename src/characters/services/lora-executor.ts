/**
 * @module LoRA 학습 실행기
 * @description ComfyUI FluxTrainer 학습 실행 + 체크포인트 등록 + 추론 테스트
 *
 * @dependencies comfyui, db, lora-dataset, lora-workflows
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import { comfyuiClient } from '../../comfyui/client';
import {
  buildLoraTrainWorkflow,
  buildLoraInferenceWorkflow,
} from '../../comfyui/workflows/lora-workflows';
import { getConnection } from '../../db/connection';
import {
  UPDATE_TRAINING_STATUS,
  UPDATE_TRAINING_PROGRESS,
  INSERT_CHECKPOINT,
  GET_CHECKPOINT,
  INSERT_TEST_IMAGE,
} from '../../db/queries/lora-queries';
import type { CheckpointRow } from '../../db/queries/lora-queries';
import type { LoraTrainingConfig } from '../types/lora.types';
import { TEST_PROMPTS } from '../types/lora.types';
import { listDatasetImages } from './lora-dataset';
import { config } from '../../config';
import { createThumbnail, restoreImageFromBlob } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import { execSql, queryOne } from './lora-db-helpers';

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

/** 실제 학습 실행 (내부) */
export async function executeTraining(
  jobId: string,
  charId: string,
  datasetId: string,
  cfg: LoraTrainingConfig,
  events: EventEmitter,
): Promise<void> {
  const images = await listDatasetImages(datasetId);
  if (images.length === 0) throw new Error('데이터셋에 이미지가 없습니다');
  await comfyuiClient.connect();
  for (const img of images) {
    const tempPath = await restoreImageFromBlob(img.IMAGE_BLOB, `train_${datasetId}`);
    await comfyuiClient.uploadImage(tempPath);
  }

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
    events.emit(`train:${jobId}`, { jobId, step, total: cfg.maxTrainSteps });
    execSql(UPDATE_TRAINING_PROGRESS, { jobId, currentStep: step }).catch(() => {});
  });
  await comfyuiClient.waitForResult(promptId, 3_600_000);
  await registerCheckpoints(jobId, outputName, cfg);
  await execSql(UPDATE_TRAINING_STATUS, { jobId, status: 'completed', errorMessage: null });
  events.emit(`train:${jobId}`, {
    jobId,
    step: cfg.maxTrainSteps,
    total: cfg.maxTrainSteps,
    status: 'completed',
  });
  logger.info('학습 완료', { jobId, charId });
}

/** 단일 추론 테스트를 실행한다. */
async function runSingleTest(
  checkpointId: string,
  fileName: string,
  prompt: string,
  seed: number,
  strength: number,
): Promise<void> {
  const wf = buildLoraInferenceWorkflow({
    loraFileName: fileName,
    prompt,
    seed,
    loraStrength: strength,
  });
  const pid = await comfyuiClient.submitWorkflow(wf);
  const { images: results } = await comfyuiClient.waitForResult(pid, 120_000);
  if (results.length === 0) return;
  const imgBuf = await downloadComfyImage(results[0]);
  
  // BLOB 및 썸네일 준비
  const thumbBuf = await createThumbnail(imgBuf);

  await execSql(INSERT_TEST_IMAGE, {
    testImageId: randomUUID(),
    checkpointId,
    promptText: prompt,
    seed,
    loraStrength: strength,
    imageBlob: imgBuf,
    thumbnailBlob: thumbBuf,
  });
}

/** 체크포인트에 대해 추론 테스트를 실행한다. */
export async function runTestCheckpoint(
  charId: string,
  checkpointId: string,
  triggerWord: string,
  loraStrength: number | undefined,
  events: EventEmitter,
): Promise<void> {
  const row = await queryOne<CheckpointRow>(GET_CHECKPOINT, { checkpointId });
  if (!row) throw new Error(`체크포인트를 찾을 수 없음: ${checkpointId}`);
  const strength = loraStrength ?? 0.7;
  await comfyuiClient.connect();
  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const prompt = `${triggerWord}, ${TEST_PROMPTS[i]}`;
    events.emit(`test:${checkpointId}`, {
      checkpointId,
      current: i + 1,
      total: TEST_PROMPTS.length,
      prompt,
    });
    await runSingleTest(checkpointId, row.FILE_NAME, prompt, 42 + i, strength);
    logger.debug('추론 테스트 완료', { checkpointId, seed: 42 + i });
  }
  events.emit(`test:${checkpointId}`, {
    checkpointId,
    current: TEST_PROMPTS.length,
    total: TEST_PROMPTS.length,
    status: 'completed',
  });
  logger.info('체크포인트 추론 테스트 완료', { checkpointId, charId });
}
