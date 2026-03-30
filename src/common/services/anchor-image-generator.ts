/**
 * @module 앵커 이미지 생성 서비스
 * @description 폴리모르픽 앵커 이미지 배치 생성 (캐릭터/장소/NPC)
 *
 * ┌──────────────────┐     ┌─────────────────────┐     ┌──────────┐
 * │ 생성 요청        │ ──→ │ 배치 처리 (병렬)    │ ──→ │ DB 저장  │
 * │ (entityType)     │     │ (ComfyUI 순차)     │     │ (Oracle) │
 * └──────────────────┘     └─────────────────────┘     └──────────┘
 *                                 ↓
 *                          품질 평가 (Python)
 *
 * @dependencies time-utils, file-utils, logger, anchor-image-processor
 * @author AI Video Factory
 */

import path from 'path';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir } from '../../common/utils/file-utils';
import { logger } from '../../common/logger';
import { processOneAnchor } from './anchor-image-processor';
import type {
  AnchorGenerationRequest,
  AnchorGenerationJob,
  AnchorResult,
  AnchorEntityType,
  PulidModeOptions,
} from '../../common/types/anchor-image.types';

const activeJobs: Map<string, AnchorGenerationJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/anchors');

/**
 * 앵커 이미지 생성 작업을 시작한다.
 * 비동기 배치 처리를 등록하고 jobId를 반환한다.
 *
 * @param req - 생성 요청 정보
 * @returns jobId 문자열
 */
export async function startAnchorGeneration(
  req: AnchorGenerationRequest,
): Promise<string> {
  const jobId = generateJobId('anch');
  const job: AnchorGenerationJob = {
    jobId,
    entityType: req.entityType,
    entityId: req.entityId,
    status: 'generating',
    total: req.count,
    completed: 0,
    anchors: [],
  };

  activeJobs.set(jobId, job);
  logger.info('앵커 생성 작업 시작', {
    jobId,
    entityType: req.entityType,
    entityId: req.entityId,
    count: req.count,
  });

  processBatch(job, req).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('앵커 배치 생성 실패', { jobId, error: message });
    job.status = 'failed';
  });

  return jobId;
}

/**
 * jobId로 현재 진행 중인 작업을 조회한다.
 *
 * @param jobId - 작업 ID
 * @returns 작업 정보 또는 undefined
 */
export function getJob(jobId: string): AnchorGenerationJob | undefined {
  return activeJobs.get(jobId);
}

/**
 * jobId의 생성된 앵커 이미지 목록을 반환한다.
 *
 * @param jobId - 작업 ID
 * @returns AnchorResult 배열
 */
export function getJobAnchors(jobId: string): AnchorResult[] {
  return activeJobs.get(jobId)?.anchors ?? [];
}

/**
 * 진행 중인 앵커 생성 작업을 중단한다.
 *
 * @param jobId - 작업 ID
 * @returns 성공 여부
 */
export function stopAnchorGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  logger.info('앵커 생성 중단 요청', { jobId });
  return true;
}

/**
 * 배치 작업을 순차 처리한다. 요청 개수만큼 루프를 돌며 processOneAnchor를 호출한다.
 *
 * @internal
 */
async function processBatch(
  job: AnchorGenerationJob,
  req: AnchorGenerationRequest,
): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, req.entityType, req.entityId, job.jobId);
  await ensureDir(outDir);

  for (let i = 0; i < req.count; i++) {
    if (job.shouldStop) {
      job.status = 'stopped';
      logger.info('앵커 생성 중단', {
        jobId: job.jobId,
        completed: job.completed,
        total: job.total,
      });
      break;
    }

    try {
      await processOneAnchor(job, req.entityType, outDir, req.customPrompt, req.pulidOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.lastError = msg;
      logger.error('개별 앵커 생성 실패', { jobId: job.jobId, error: msg });
      if (job.completed === 0) {
        job.status = 'failed';
        return;
      }
    }
  }

  if (!job.shouldStop) {
    job.status = 'completed';
    logger.info('앵커 배치 생성 완료', {
      jobId: job.jobId,
      total: job.total,
      completed: job.completed,
    });
  }
}
