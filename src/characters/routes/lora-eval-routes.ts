/**
 * @module LoRA 평가 라우트
 * @description 체크포인트 조회, 추론 테스트, 체크포인트 선택 API.
 *
 * @dependencies express, lora-training
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  listCheckpoints,
  testCheckpoint,
  selectCheckpoint,
  trainingEvents,
} from '../services/lora-training';
import { logger } from '../../common/logger';
import type { TestCheckpointRequest, SelectCheckpointRequest } from '../types/lora.types';

const router = Router();

// ─── 체크포인트 조회 ──────────────────────────────────────

router.get(
  '/:charId/lora/checkpoints',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.query.jobId);

    if (!jobId || jobId === 'undefined') {
      res.status(400).json({ success: false, error: 'jobId 쿼리 파라미터는 필수입니다' });
      return;
    }

    const rows = await listCheckpoints(jobId);
    res.json({ success: true, data: rows });
  }),
);

// ─── 추론 테스트 ──────────────────────────────────────────

router.post(
  '/:charId/lora/test',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { checkpointId, loraStrength } = req.body as TestCheckpointRequest;
    const triggerWord = (req.body as Record<string, unknown>).triggerWord as string | undefined;

    if (!checkpointId) {
      res.status(400).json({ success: false, error: 'checkpointId는 필수입니다' });
      return;
    }

    testCheckpoint(charId, checkpointId, triggerWord ?? '', loraStrength).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('체크포인트 테스트 실패', { charId, checkpointId, error: msg });
    });

    logger.info('체크포인트 테스트 시작 API 호출', { charId, checkpointId });
    res.json({ success: true, data: { checkpointId, status: 'testing' } });
  }),
);

router.get('/:charId/lora/test/stream', (req: Request, res: Response) => {
  const checkpointId = String(req.query.checkpointId);

  if (!checkpointId || checkpointId === 'undefined') {
    res.status(400).json({ success: false, error: 'checkpointId 쿼리 파라미터는 필수입니다' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  trainingEvents.on(`test:${checkpointId}`, onProgress);

  req.on('close', () => {
    trainingEvents.off(`test:${checkpointId}`, onProgress);
  });
});

// ─── 체크포인트 선택 ──────────────────────────────────────

router.post(
  '/:charId/lora/select',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { checkpointId } = req.body as SelectCheckpointRequest;
    const jobId = String(req.query.jobId);

    if (!checkpointId) {
      res.status(400).json({ success: false, error: 'checkpointId는 필수입니다' });
      return;
    }
    if (!jobId || jobId === 'undefined') {
      res.status(400).json({ success: false, error: 'jobId 쿼리 파라미터는 필수입니다' });
      return;
    }

    await selectCheckpoint(charId, jobId, checkpointId);
    logger.info('체크포인트 선택 API 호출', { charId, jobId, checkpointId });
    res.json({ success: true, data: { charId, checkpointId } });
  }),
);

export default router;
