/**
 * @module 파생 이미지 + SSE 라우터
 * @description 파생 이미지 생성/조회/스트리밍 + 중단/재생성 API.
 *
 * @dependencies derivative-generator
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  startDerivativeGeneration,
  getDerivativeJob,
  derivativeEvents,
  stopDerivativeGeneration,
  regenerateSingleDerivative,
} from '../services/derivative-generator';
import refImageRoutes from './ref-image-routes';

const router = Router();

router.use('/', refImageRoutes);

// ─── 파생 이미지 ────────────────────────────────────────────

router.post(
  '/derivatives/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const { charId, anchorPath, basePrompt } = req.body as {
      charId: string;
      anchorPath: string;
      basePrompt: string;
    };
    if (!charId || !anchorPath) {
      res.status(400).json({ success: false, error: 'charId와 anchorPath는 필수입니다' });
      return;
    }

    const jobId = startDerivativeGeneration(charId, anchorPath, basePrompt || '');
    res.json({ success: true, jobId });
  }),
);

router.get(
  '/derivatives/:jobId/status',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getDerivativeJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: '파생 작업을 찾을 수 없습니다' });
      return;
    }

    res.json({ success: true, data: job });
  }),
);

// ─── SSE: 파생 실시간 진행 ──────────────────────────────────

router.get('/derivatives/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getDerivativeJob(jobId);

  if (!job) {
    res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(
    `data: ${JSON.stringify({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      completed: job.completed,
      currentStep: job.currentStep,
      results: job.results,
    })}\n\n`,
  );

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  derivativeEvents.on(`job:${jobId}`, onProgress);
  req.on('close', () => {
    derivativeEvents.off(`job:${jobId}`, onProgress);
  });
});

// ─── 생성 작업 중단 + 재생성 ─────────────────────────────────

router.post(
  '/derivatives/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const stopped = stopDerivativeGeneration(jobId);

    if (!stopped) {
      res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
      return;
    }

    res.json({ success: true, message: '파생 생성 중단 요청 완료' });
  }),
);

router.post(
  '/derivatives/:jobId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const { label, modifyPrompt } = req.body as {
      label: string;
      modifyPrompt: string;
    };

    if (!label) {
      res.status(400).json({ success: false, error: 'label은 필수입니다' });
      return;
    }

    const result = await regenerateSingleDerivative(jobId, label, modifyPrompt ?? '');
    res.json({ success: true, result });
  }),
);

export default router;
