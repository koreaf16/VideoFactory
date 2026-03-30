/**
 * @module 장소 배경 후보 생성 서비스
 * @description ControlNet depth/normal map을 사용해 배경 이미지를 배치 생성한다.
 *
 * @dependencies comfyui, location-queries, db
 * @author AI Video Factory
 */

import path from 'path';
import { comfyuiClient } from '../../comfyui/client';
import { buildControlNetCandidateWorkflow } from '../../comfyui/workflows/controlnet-workflows';
import { getMapPaths } from './blender-renderer';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { findLocationById } from '../../db/queries/location-queries';
import { insertLocCandidate } from '../../db/queries/location-candidate-queries';
import { scoreImage } from '../../python-api/endpoints/quality-api';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import { buildLocPrompts, assignGrade, isOutdoorPrompt } from './location-prompt-helpers';

export { isOutdoorPrompt };

// ─── 인터페이스 ─────────────────────────────────────────

export interface LocCandidateResult {
  candidateId?: number;
  imagePath: string;
  prompt: string;
  seed: number;
  qualityScore?: number;
  grade?: string;
}

export interface LocGenerationJob {
  jobId: string;
  locationId: string;
  status: 'generating' | 'scoring' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  candidates: LocCandidateResult[];
  lastError?: string;
  shouldStop?: boolean;
}

// ─── 인메모리 작업 관리 ──────────────────────────────────

const activeJobs: Map<string, LocGenerationJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/locations');

// ─── 공개 API ───────────────────────────────────────────

export async function startLocCandidateGeneration(
  locationId: string,
  count: number,
  customPrompt?: string,
  width?: number,
  height?: number,
): Promise<string> {
  let promptBase = customPrompt ?? '';
  if (!promptBase) {
    const conn = await getConnection();
    try {
      const loc = await findLocationById(conn, locationId);
      if (!loc) throw new Error(`장소를 찾을 수 없습니다: ${locationId}`);
      promptBase = loc.PROMPT_BASE ?? '';
    } finally {
      await conn.close();
    }
  }
  if (!promptBase) throw new Error('프롬프트가 없습니다. promptBase를 등록해주세요.');

  const prompts = buildLocPrompts(promptBase, count);
  const jobId = generateJobId('loc');
  const job: LocGenerationJob = {
    jobId,
    locationId,
    status: 'generating',
    total: prompts.length,
    completed: 0,
    candidates: [],
  };
  activeJobs.set(jobId, job);
  logger.info('장소 후보 생성 시작', { jobId, locationId, count: prompts.length });

  processBatch(job, prompts, width ?? 1024, height ?? 1024).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('장소 후보 배치 생성 실패', { jobId, error: message });
    job.status = 'failed';
    job.lastError = message;
  });
  return jobId;
}

export function getLocJob(jobId: string): LocGenerationJob | undefined {
  return activeJobs.get(jobId);
}

export function stopLocCandidateGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  logger.info('장소 후보 생성 중단 요청', { jobId });
  return true;
}

// ─── 내부 배치 처리 ─────────────────────────────────────

async function processOneLocCandidate(
  job: LocGenerationJob,
  promptItem: { prompt: string; seed: number },
  outDir: string,
  width: number,
  height: number,
): Promise<void> {
  const { depthMaps, normalMaps } = getMapPaths(job.locationId);
  if (depthMaps.length === 0) {
    throw new Error('depth map이 없습니다. Phase 1(뼈대 생성)을 먼저 실행하세요.');
  }

  await comfyuiClient.connect();
  const depthName = await comfyuiClient.uploadImage(depthMaps[0]);
  const normalName =
    normalMaps.length > 0 ? await comfyuiClient.uploadImage(normalMaps[0]) : depthName;

  const workflow = buildControlNetCandidateWorkflow({
    depthMapName: depthName,
    normalMapName: normalName,
    prompt: promptItem.prompt,
    seed: promptItem.seed,
    width,
    height,
    filenamePrefix: `${job.locationId}_${promptItem.seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const { images } = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageBuffer = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
  const filename = `${job.locationId}_${promptItem.seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), await createThumbnail(imageBuffer));

  const candidate: LocCandidateResult = {
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
    logger.warn('품질 평가 실패 (건너뜀)', {
      jobId: job.jobId,
      error: scoreErr instanceof Error ? scoreErr.message : String(scoreErr),
    });
  }

  const conn = await getConnection();
  try {
    candidate.candidateId = await insertLocCandidate(conn, {
      locationId: job.locationId,
      jobId: job.jobId,
      imagePath,
      promptText: promptItem.prompt,
      seed: promptItem.seed,
    });
  } finally {
    await conn.close();
  }

  job.candidates.push(candidate);
  job.completed += 1;
  job.status = 'generating';
  logger.debug('장소 후보 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
  });
}

async function processBatch(
  job: LocGenerationJob,
  prompts: { prompt: string; seed: number }[],
  width: number,
  height: number,
): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, job.locationId, job.jobId);
  await ensureDir(outDir);

  for (const promptItem of prompts) {
    if (job.shouldStop) {
      job.status = 'stopped';
      logger.info('장소 후보 생성 중단', { jobId: job.jobId, completed: job.completed });
      break;
    }
    try {
      await processOneLocCandidate(job, promptItem, outDir, width, height);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.lastError = msg;
      logger.error('장소 개별 후보 생성 실패', { jobId: job.jobId, error: msg });
      if (job.completed === 0) {
        job.status = 'failed';
        return;
      }
    }
  }

  if (job.status === 'generating') {
    job.status = 'completed';
    logger.info('장소 후보 생성 완료', { jobId: job.jobId, total: job.completed });
  }
}
