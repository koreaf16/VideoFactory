/**
 * @module 장소 Phase 1 스켈레톤 라우터
 * @description 블렌더 스켈레톤 생성(SSE), 프리뷰 조회, 스타일 앵커 설정 API.
 *
 * ┌──────────────────┐
 * │ POST /generate-skeleton  → Phase 1 시작 (Claude CLI → Blender)
 * │ GET  /skeleton-stream    → SSE 진행률 스트림
 * │ GET  /skeleton-preview   → depth/normal map 경로 반환
 * │ POST /set-anchor         → 후보 이미지를 style_anchor.png 로 복사
 * └──────────────────┘
 *
 * @dependencies blender-script-generator, blender-renderer, blender-prompt
 * @author AI Video Factory
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Router, Request, Response } from 'express';
import oracledb from 'oracledb';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { generateAndSaveBlenderScript } from '../services/blender-script-generator';
import { renderMaps, validateResults, getMapPaths } from '../services/blender-renderer';
import { CAMERA_ANGLES } from '../templates/blender-prompt';
import { logger } from '../../common/logger';
import type { LocCandidateRow } from '../../db/queries/location-candidate-queries';

const router = Router();

// ─── 인메모리 스켈레톤 작업 저장소 ──────────────────────

interface SkeletonJob {
  jobId: string;
  locationId: string;
  status: 'script_generating' | 'rendering' | 'validating' | 'completed' | 'failed';
  currentStep: string;
  error?: string;
}

const skeletonJobs = new Map<string, SkeletonJob>();

// ─── SSE 이벤트 에미터 ───────────────────────────────────

export const skeletonEvents = new EventEmitter();
skeletonEvents.setMaxListeners(50);

// ─── 내부 헬퍼 ──────────────────────────────────────────

function emitProgress(job: SkeletonJob): void {
  skeletonEvents.emit(`job:${job.jobId}`, {
    jobId: job.jobId,
    locationId: job.locationId,
    status: job.status,
    currentStep: job.currentStep,
    error: job.error,
  });
}

// ─── POST /:locationId/generate-skeleton ─────────────────

router.post(
  '/:locationId/generate-skeleton',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const { description } = req.body as { description?: string };

    if (!description) {
      res.status(400).json({ success: false, error: 'description은 필수입니다' });
      return;
    }

    const jobId = `skel_${locationId}_${Date.now()}`;
    const job: SkeletonJob = {
      jobId,
      locationId,
      status: 'script_generating',
      currentStep: '블렌더 스크립트 생성 중',
    };
    skeletonJobs.set(jobId, job);

    logger.info('스켈레톤 작업 시작', { jobId, locationId });

    // Fire-and-forget 비동기 파이프라인
    void (async (): Promise<void> => {
      try {
        // 1단계: 스크립트 생성 (Claude CLI)
        job.status = 'script_generating';
        job.currentStep = '블렌더 스크립트 생성 중 (Claude CLI)';
        emitProgress(job);

        const { scriptPath } = await generateAndSaveBlenderScript(locationId, description);
        logger.info('스크립트 생성 완료', { jobId, scriptPath });

        // 2단계: 블렌더 렌더링
        job.status = 'rendering';
        job.currentStep = 'Blender depth/normal map 렌더링 중';
        emitProgress(job);

        await renderMaps(locationId, scriptPath);
        logger.info('블렌더 렌더링 완료', { jobId });

        // 3단계: 결과 검증
        job.status = 'validating';
        job.currentStep = '렌더링 결과 검증 중';
        emitProgress(job);

        const validation = await validateResults(locationId);
        if (!validation.valid) {
          throw new Error(`렌더링 검증 실패: ${validation.errors.join(', ')}`);
        }
        logger.info('렌더링 검증 완료', { jobId });

        // 완료
        job.status = 'completed';
        job.currentStep = `완료 — depth ${validation.depthCount}개, normal ${validation.normalCount}개`;
        emitProgress(job);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('스켈레톤 파이프라인 오류', { jobId, error: msg });
        job.status = 'failed';
        job.currentStep = '오류 발생';
        job.error = msg;
        emitProgress(job);
      }
    })();

    res.json({ success: true, jobId });
  }),
);

// ─── GET /:locationId/skeleton-stream ────────────────────

router.get('/:locationId/skeleton-stream', (req: Request, res: Response) => {
  const { jobId } = req.query as { jobId?: string };

  if (!jobId) {
    res.status(400).json({ error: 'jobId 쿼리 파라미터가 필요합니다' });
    return;
  }

  const job = skeletonJobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: '스켈레톤 작업을 찾을 수 없습니다' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 현재 상태를 초기값으로 즉시 전송
  res.write(
    `data: ${JSON.stringify({
      jobId: job.jobId,
      locationId: job.locationId,
      status: job.status,
      currentStep: job.currentStep,
      error: job.error,
    })}\n\n`,
  );

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  skeletonEvents.on(`job:${jobId}`, onProgress);
  req.on('close', () => {
    skeletonEvents.off(`job:${jobId}`, onProgress);
  });
});

// ─── GET /:locationId/skeleton-preview ───────────────────

router.get(
  '/:locationId/skeleton-preview',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);

    const { depthMaps, normalMaps } = getMapPaths(locationId);

    const cameraAngles = CAMERA_ANGLES.map((cam) => ({
      id: cam.id,
      label: cam.label,
      depthMap: depthMaps.find((p) => path.basename(p, '.png') === cam.id) ?? null,
      normalMap: normalMaps.find((p) => path.basename(p, '.png') === cam.id) ?? null,
    }));

    res.json({
      success: true,
      data: {
        depthMaps,
        normalMaps,
        cameraAngles,
      },
    });
  }),
);

// ─── POST /:locationId/set-anchor ────────────────────────

router.post(
  '/:locationId/set-anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const { candidateId } = req.body as { candidateId?: number };

    if (!candidateId) {
      res.status(400).json({ success: false, error: 'candidateId는 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      // 1. 후보 이미지 경로 조회
      const result = await conn.execute<LocCandidateRow>(
        'SELECT candidate_id, location_id, image_path FROM location_candidates WHERE candidate_id = :candidateId',
        { candidateId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const candidate = result.rows?.[0];

      if (!candidate) {
        res.status(404).json({ success: false, error: '후보를 찾을 수 없습니다' });
        return;
      }

      if (candidate.LOCATION_ID !== locationId) {
        res.status(400).json({ success: false, error: '후보가 해당 장소에 속하지 않습니다' });
        return;
      }

      if (!candidate.IMAGE_PATH || !fs.existsSync(candidate.IMAGE_PATH)) {
        res.status(400).json({ success: false, error: '후보 이미지 파일을 찾을 수 없습니다' });
        return;
      }

      // 2. style_anchor.png 복사
      const destDir = path.join('uploads', 'locations', locationId);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      const destPath = path.join(destDir, 'style_anchor.png');
      fs.copyFileSync(candidate.IMAGE_PATH, destPath);
      logger.info('스타일 앵커 파일 복사 완료', { locationId, candidateId, destPath });

      // 3. location_type 업데이트
      await conn.execute(
        `UPDATE locations SET location_type = 'anchor_set' WHERE location_id = :lid`,
        { lid: locationId },
        { autoCommit: true },
      );
      logger.info('location_type anchor_set 업데이트 완료', { locationId });

      res.json({ success: true, anchorPath: destPath });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
