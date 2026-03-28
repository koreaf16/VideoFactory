/**
 * @module 파생 이미지 생성 서비스
 * @description 앵커 이미지 기준으로 유사 얼굴 이미지를 목표 수량까지 반복 생성한다.
 *
 * ┌──────────┐     ┌───────────┐     ┌──────────────┐     ┌──────────┐
 * │ 프리셋   │ ──→ │ ComfyUI   │ ──→ │face_recognition│ ──→ │ 유사: 유지│
 * │ + 외모   │     │(Kontext)  │     │ (유사도 비교)  │     │ 비유사: 삭제│
 * └──────────┘     └───────────┘     └──────────────┘     └──────────┘
 *       ↑                                                      │
 *  30장 미만이면 ←────────────── 반복 ────────────────────────────┘
 *
 * @dependencies comfyui, derivative-presets, derivative-filter, db
 * @author AI Video Factory
 */

import path from 'path';
import { EventEmitter } from 'events';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import {
  DERIVATIVE_PRESETS,
  extractAppearanceOnly,
  type DerivativePreset,
  type DerivativeResult,
  type DerivativeJob,
} from './derivative-presets';
import { filterAndDeleteDissimilar } from './derivative-filter';

export type { DerivativeResult, DerivativeJob };

// ─── SSE 이벤트 에미터 ───────────────���──────────────────

export const derivativeEvents = new EventEmitter();
derivativeEvents.setMaxListeners(50);

function emitProgress(job: DerivativeJob): void {
  derivativeEvents.emit(`job:${job.jobId}`, {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    completed: job.completed,
    generated: job.generated,
    deleted: job.deleted,
    batch: job.batch,
    currentStep: job.currentStep,
    results: job.results,
  });
}

// ─── 인메모리 작업 관리 ──────────────────────────────────

const activeJobs: Map<string, DerivativeJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/derivatives');

// ─── 공개 API ─────────────────���─────────────────────────

/** 파생 이미지 생성을 시작한다. 목표 수량까�� 반복 생성. */
export function startDerivativeGeneration(
  charId: string,
  anchorPath: string,
  basePrompt: string,
): string {
  const jobId = generateJobId('deriv');
  const job: DerivativeJob = {
    jobId,
    charId,
    anchorPath,
    status: 'preparing',
    total: DERIVATIVE_PRESETS.length,
    completed: 0,
    generated: 0,
    deleted: 0,
    batch: 0,
    currentStep: '준비 중...',
    results: [],
  };

  activeJobs.set(jobId, job);
  logger.info('파생 생성 시작 (유사도 필터�� 모드)', { jobId, charId, targetCount: job.total });

  processDerivativeLoop(job, basePrompt).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('파생 생성 실패', { jobId, error: message });
    job.status = 'failed';
    job.currentStep = `실패: ${message}`;
    emitProgress(job);
  });

  return jobId;
}

export function getDerivativeJob(jobId: string): DerivativeJob | undefined {
  return activeJobs.get(jobId);
}

export function stopDerivativeGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  logger.info('파생 생성 중단 요청', { jobId });
  return true;
}

// ─── 이미지 생성 (1장) ──────────────────────────────────

async function generateOneImage(
  job: DerivativeJob,
  preset: DerivativePreset,
  basePrompt: string,
  outDir: string,
): Promise<DerivativeResult | null> {
  const seed = Math.floor(Math.random() * 999999999);
  const appearancePrompt = extractAppearanceOnly(basePrompt);
  const fullPrompt = appearancePrompt
    ? `${preset.promptSuffix}, ${appearancePrompt}`
    : preset.promptSuffix;

  job.currentStep = `${preset.label} 생성 중... (${job.generated + 1}/${job.total})`;
  emitProgress(job);

  await comfyuiClient.connect();
  const anchorName = await comfyuiClient.uploadImage(job.anchorPath);
  const editPrompt = `same character, ${preset.promptSuffix}`;
  const workflow = buildKontextEditWorkflow({
    anchorImageName: anchorName,
    editPrompt,
    seed,
    filenamePrefix: `${job.charId}_${preset.label}_${seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 120_000);
  if (images.length === 0) throw new Error('ComfyUI 편집 결과 없음');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${job.charId}_${preset.label}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);

  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  const refId = await saveDerivativeToDb(job.charId, imagePath, preset.label);
  job.generated += 1;

  return {
    refId,
    imagePath,
    label: preset.label,
    prompt: fullPrompt,
    seed,
    skipSimilarity: preset.skipSimilarity,
  };
}

async function saveDerivativeToDb(
  charId: string,
  imagePath: string,
  poseTag: string,
): Promise<number | undefined> {
  const oracledb = await import('oracledb');
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `INSERT INTO char_ref_images (char_id, image_path, pose_tag)
       VALUES (:charId, :imagePath, :poseTag)
       RETURNING ref_id INTO :refId`,
      { charId, imagePath, poseTag, refId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
      { autoCommit: true },
    );
    const outBinds = result.outBinds as unknown as { refId: number[] };
    return outBinds.refId[0];
  } finally {
    await conn.close();
  }
}

// ─── 메인 루프 ────���─────────────────────────────────────

async function processDerivativeLoop(job: DerivativeJob, basePrompt: string): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, job.charId, job.jobId);
  await ensureDir(outDir);
  job.status = 'generating';

  for (const preset of DERIVATIVE_PRESETS) {
    if (job.shouldStop) {
      job.status = 'stopped';
      job.currentStep = `중단됨 — ${job.completed}/${job.total} 포즈 완료`;
      emitProgress(job);
      return;
    }
    try {
      const result = await generateOneImage(job, preset, basePrompt, outDir);
      if (result) job.results.push(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('이미지 생성 실패', { label: preset.label, error: msg });
    }
    job.completed += 1;
    emitProgress(job);
  }

  const allGenerated = [...job.results];
  const kept = await filterAndDeleteDissimilar(job, allGenerated, emitProgress);
  job.results = kept;
  job.status = 'completed';
  job.currentStep = `완료! ${kept.length}/${allGenerated.length}장 유사 통과 (${job.deleted}장 삭제)`;
  emitProgress(job);
  logger.info('파생 생성 완료', {
    jobId: job.jobId,
    generated: job.generated,
    kept: kept.length,
    deleted: job.deleted,
  });
}
