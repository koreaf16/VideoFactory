/**
 * @module 후보 이미지 생성 서비스
 * @description 캐릭터 외형 정보로 ComfyUI를 통해 후보 이미지를 배치 생성한다.
 *
 * ┌─────────────┐     ┌──────────┐     ┌───────────┐     ┌─────────────┐     ┌──────────┐
 * │ PromptBuilder│ ──→ │ ComfyUI  │ ──→ │ SaveImage │ ──→ │ QualityScore│ ──→ │ DB Insert│
 * │ (프롬프트)    │     │ (생성)   │     │ (파일)    │     │ (Python API)│     │ (Oracle) │
 * └─────────────┘     └──────────┘     └───────────┘     └─────────────┘     └──────────┘
 *
 * @dependencies comfyui, prompt-builder, quality-api, db
 * @author AI Video Factory
 */

import path from 'path';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextAnchorWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { generateAnchorCandidatePrompts, CandidatePrompt } from './prompt-builder';
import { buildNegativePrompt } from '../templates/negative-prompts';
import { scoreImage } from '../../python-api/endpoints/quality-api';
import { getConnection } from '../../db/connection';
import { findCharacterById } from '../../db/queries/character-queries';
import { insertCandidate } from '../../db/queries/candidate-queries';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
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
function assignGrade(score: number): string {
  if (score >= 0.9) return 'S';
  if (score >= 0.8) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}

// ─── 공개 API ───────────────────────────────────────────

/** 후보 이미지 배치 생성을 시작한다. jobId를 즉시 반환한다. */
export async function startCandidateGeneration(
  charId: string,
  count: number,
  customPrompt?: string,
): Promise<string> {
  let prompts: CandidatePrompt[];

  if (customPrompt) {
    // 커스텀 프롬프트 모드: 앵커용 flat lighting 변형 (증명사진 스타일)
    const anchorVariations = [
      '', // 원본 그대로
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
    prompts = Array.from({ length: count }, (_, i) => ({
      prompt: customPrompt + (anchorVariations[i % anchorVariations.length] || ''),
      negativePrompt: anchorNegative,
      seed: Math.floor(Math.random() * 999999999),
      expression: 'anchor',
      angle: 'front',
      lighting: 'studio_flat',
      scene: 'master_portrait',
    }));
  } else {
    // 자동 프롬프트 모드: DB 외모 정보 기반 조합
    const conn = await getConnection();
    try {
      const character = await findCharacterById(conn, charId);
      if (!character) throw new Error(`캐릭터를 찾을 수 없습니다: ${charId}`);

      const rawAppearance = (character as unknown as Record<string, unknown>).APPEARANCE;
      const appearance: CharacterAppearance =
        typeof rawAppearance === 'string'
          ? (JSON.parse(rawAppearance) as CharacterAppearance)
          : (rawAppearance as CharacterAppearance);

      prompts = generateAnchorCandidatePrompts(appearance, count);
    } finally {
      await conn.close();
    }
  }

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
  logger.info('후보 생성 작업 시작', {
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

async function processOneCandidate(
  job: GenerationJob,
  promptItem: CandidatePrompt,
  outDir: string,
): Promise<void> {
  // Build and submit Kontext workflow
  const workflow = buildKontextAnchorWorkflow({
    prompt: promptItem.prompt,
    seed: promptItem.seed,
    filenamePrefix: `${job.charId}_${promptItem.seed}`,
  });
  await comfyuiClient.connect();
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 120_000);
  if (images.length === 0) {
    throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');
  }
  // Download image from ComfyUI output
  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${job.charId}_${promptItem.seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);

  // 썸네일 생성
  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  // 품질 평가 (실패 시 건너뜀)
  const candidate: CandidateResult = {
    imagePath,
    prompt: promptItem.prompt,
    seed: promptItem.seed,
  };
  job.status = 'scoring';

  try {
    const scoreResult = await scoreImage(imagePath);
    if (scoreResult.success && scoreResult.data) {
      candidate.qualityScore = scoreResult.data.score;
      candidate.grade = assignGrade(scoreResult.data.score);
    }
  } catch (scoreErr: unknown) {
    const msg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
    logger.warn('품질 평가 실패 (건너뜀)', { jobId: job.jobId, error: msg });
  }

  // DB 저장 + candidateId 받기
  const conn = await getConnection();
  try {
    const candidateId = await insertCandidate(conn, {
      charId: job.charId,
      jobId: job.jobId,
      imagePath,
      promptText: promptItem.prompt,
      seed: promptItem.seed,
      qualityScore: candidate.qualityScore ?? null,
      grade: candidate.grade ?? null,
    });
    candidate.candidateId = candidateId;
  } finally {
    await conn.close();
  }

  job.candidates.push(candidate);
  job.completed += 1;
  job.status = 'generating';
  logger.debug('후보 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
    score: candidate.qualityScore,
  });
}

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
      // 첫 실패 후 즉시 중단 (같은 오류가 반복되는 것을 방지)
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
