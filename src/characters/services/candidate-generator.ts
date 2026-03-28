/**
 * @module 후보 이미지 생성 서비스
 * @description 캐릭터 외형 정보로 ComfyUI를 통해 후보 이미지를 배치 생성한다.
 *
 * ┌─────────────┐     ┌──────────┐     ┌───────────┐     ┌─────────────┐     ┌──────────┐
 * │ PromptBuilder│ ──→ │ ComfyUI  │ ──→ │ SaveImage │ ──→ │ QualityScore│ ──→ │ DB Insert│
 * │ (프롬프트)    │     │ (생성)   │     │ (파일)    │     │ (Python API)│     │ (Oracle) │
 * └─────────────┘     └──────────┘     └───────────┘     └─────────────┘     └──────────┘
 *
 * @dependencies comfyui, prompt-builder, candidate-processor, db
 * @author AI Video Factory
 */

import path from 'path';
import { generateAnchorCandidatePrompts, CandidatePrompt } from './prompt-builder';
import { buildNegativePrompt } from '../templates/negative-prompts';
import { getConnection } from '../../db/connection';
import { findCharacterById } from '../../db/queries/character-queries';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir } from '../../common/utils/file-utils';
import { logger } from '../../common/logger';
import { processOneCandidate } from './candidate-processor';
import type { CharacterAppearance } from '../types/character.types';

// ─── 인터페이스 ─────────────────────────────────────────

export interface CandidateResult {
  candidateId?: number;
  imagePath: string;
  prompt: string;
  seed: number;
  qualityScore?: number;
  grade?: string;
}

export interface GenerationJob {
  jobId: string;
  charId: string;
  status: 'generating' | 'scoring' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  candidates: CandidateResult[];
  lastError?: string;
  shouldStop?: boolean;
}

// ─── 인메모리 작업 관리 ──────────────────────────────────

const activeJobs: Map<string, GenerationJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/candidates');

// ─── 프롬프트 ��성 ──────────────────���──────────────────

function buildCustomPrompts(customPrompt: string, count: number): CandidatePrompt[] {
  const anchorVariations = [
    '',
    ', front view, direct eye contact, neutral expression',
    ', front view, slight smile, catch light in eyes',
    ', slight head tilt, gentle expression, soft even light',
    ', close-up face, extreme skin detail, sharp focus, 85mm lens',
    ', head and shoulders, centered composition, simple framing',
    ', front view, calm neutral expression, relaxed face',
    ', front view, subtle smile, natural expression, clear skin',
    ', very slight head turn, looking at camera, bright studio',
    ', front portrait, highly detailed face, visible skin pores',
  ];
  const anchorNegative =
    buildNegativePrompt({ includeFace: true, includeBody: true }) +
    ', cinematic lighting, dramatic shadows, rim lighting, backlight, sun flare, golden hour, bokeh, depth of field, blurry background';

  return Array.from({ length: count }, (_, i) => ({
    prompt: customPrompt + (anchorVariations[i % anchorVariations.length] || ''),
    negativePrompt: anchorNegative,
    seed: Math.floor(Math.random() * 999999999),
    expression: 'anchor',
    angle: 'front',
    lighting: 'studio_flat',
    scene: 'master_portrait',
  }));
}

async function buildDbPrompts(charId: string, count: number): Promise<CandidatePrompt[]> {
  const conn = await getConnection();
  try {
    const character = await findCharacterById(conn, charId);
    if (!character) throw new Error(`캐릭터를 찾을 수 없습니다: ${charId}`);

    const rawAppearance = (character as unknown as Record<string, unknown>).APPEARANCE;
    const appearance: CharacterAppearance =
      typeof rawAppearance === 'string'
        ? (JSON.parse(rawAppearance) as CharacterAppearance)
        : (rawAppearance as CharacterAppearance);

    return generateAnchorCandidatePrompts(appearance, count);
  } finally {
    await conn.close();
  }
}

// ─── 공개 API ───────────────────────────────────────────

/** 후보 이미지 배치 생성을 시작한다. jobId를 즉시 반환한다. */
export async function startCandidateGeneration(
  charId: string,
  count: number,
  customPrompt?: string,
): Promise<string> {
  const prompts = customPrompt
    ? buildCustomPrompts(customPrompt, count)
    : await buildDbPrompts(charId, count);

  const jobId = generateJobId('cand');
  const job: GenerationJob = {
    jobId,
    charId,
    status: 'generating',
    total: prompts.length,
    completed: 0,
    candidates: [],
  };

  activeJobs.set(jobId, job);
  logger.info('후보 생성 작업 ���작', {
    jobId,
    charId,
    count: prompts.length,
    custom: !!customPrompt,
  });

  processBatch(job, prompts).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('후보 배치 생성 실패', { jobId, error: message });
    job.status = 'failed';
  });

  return jobId;
}

export function getJob(jobId: string): GenerationJob | undefined {
  return activeJobs.get(jobId);
}

export function getJobCandidates(jobId: string): CandidateResult[] {
  return activeJobs.get(jobId)?.candidates ?? [];
}

export function stopCandidateGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  logger.info('후보 생성 중단 요청', { jobId });
  return true;
}

// ─── 내부 배치 처리 ─────────────────────────────────────

async function processBatch(job: GenerationJob, prompts: CandidatePrompt[]): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, job.charId, job.jobId);
  await ensureDir(outDir);
  for (const promptItem of prompts) {
    if (job.shouldStop) {
      job.status = 'stopped';
      logger.info('후보 생성 중단', {
        jobId: job.jobId,
        completed: job.completed,
        total: job.total,
      });
      break;
    }

    try {
      await processOneCandidate(job, promptItem, outDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.lastError = msg;
      logger.error('개별 후보 생성 실패', { jobId: job.jobId, error: msg });
      if (job.completed === 0) {
        job.status = 'failed';
        return;
      }
    }
  }

  if (!job.shouldStop) {
    job.status = 'completed';
    logger.info('후보 배치 생성 완료', {
      jobId: job.jobId,
      total: job.total,
      completed: job.completed,
    });
  }
}
