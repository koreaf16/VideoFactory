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

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getConnection } from '../../db/connection';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir } from '../../common/utils/file-utils';
import { logger } from '../../common/logger';
import {
  DERIVATIVE_PRESETS,
  type DerivativePreset,
  type DerivativeResult,
  type DerivativeJob,
} from './derivative-presets';
import { generateOneImage, processDerivativeLoop } from './derivative-image';

export type { DerivativeResult, DerivativeJob };

// ─── SSE 이벤트 에미터 ──────────────────────────────────

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

// ─── 공개 API ────────────────────────────────────────────

/** 파생 이미지 생성을 시작한다. 목표 수량까지 반복 생성. */
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
  logger.info('파생 생성 시작 (유사도 필터링 모드)', { jobId, charId, targetCount: job.total });

  const outDir = path.join(EXPORTS_BASE, charId, jobId);
  processDerivativeLoop(job, basePrompt, outDir, emitProgress).catch((err: unknown) => {
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

/** 원본 프리셋 프롬프트에 수정 지시를 조합한다. */
export function buildRegenPrompt(basePrompt: string, modifyPrompt: string): string {
  const trimmed = modifyPrompt.trim();
  if (!trimmed) return basePrompt;
  return `${basePrompt} Additionally: ${trimmed}`;
}

/**
 * 특정 라벨의 파생 이미지를 재생성한다.
 * 기존 파일과 DB 레코드를 삭제하고 새 이미지로 교체한다.
 */
export async function regenerateSingleDerivative(
  jobId: string,
  label: string,
  modifyPrompt: string,
): Promise<DerivativeResult> {
  const job = activeJobs.get(jobId);
  if (!job) throw new Error(`작업을 찾을 수 없습니다: ${jobId}`);

  const preset = DERIVATIVE_PRESETS.find((p) => p.label === label);
  if (!preset) throw new Error(`프리셋을 찾을 수 없습니다: ${label}`);

  if (job.status !== 'completed' && job.status !== 'stopped') {
    throw new Error('생성이 완료된 후에 재생성할 수 있습니다');
  }

  const existingIdx = job.results.findIndex((r) => r.label === label);
  const existing = existingIdx >= 0 ? job.results[existingIdx] : undefined;

  // 기존 파일 삭제
  if (existing) {
    if (fs.existsSync(existing.imagePath)) fs.unlinkSync(existing.imagePath);
    const thumbPath = path.join(
      path.dirname(existing.imagePath),
      `thumb_${path.basename(existing.imagePath)}`,
    );
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    // 기존 DB 레코드 삭제
    if (existing.refId) {
      const conn = await getConnection();
      try {
        await conn.execute(
          'DELETE FROM char_ref_images WHERE ref_id = :refId',
          { refId: existing.refId },
          { autoCommit: true },
        );
      } finally {
        await conn.close();
      }
    }
  }

  // 조합 프롬프트로 새 이미지 생성
  const combinedPreset: DerivativePreset = {
    ...preset,
    promptSuffix: buildRegenPrompt(preset.promptSuffix, modifyPrompt),
  };
  const outDir = path.join(EXPORTS_BASE, job.charId, job.jobId);
  await ensureDir(outDir);

  const newResult = await generateOneImage(job, combinedPreset, '', outDir, emitProgress);
  if (!newResult) throw new Error('이미지 생성 실패');

  if (existingIdx >= 0) {
    job.results[existingIdx] = newResult;
  } else {
    job.results.push(newResult);
  }

  logger.info('단일 파생 이미지 재생성 완료', { jobId, label, modifyPrompt });
  return newResult;
}
