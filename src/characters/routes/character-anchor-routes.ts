/**
 * @module 캐릭터 앵커 라우트
 * @description 캐릭터 앵커 이미지 생성/관리 API
 *
 * ┌──────────┐     ┌────────────────────┐     ┌──────────────────────┐
 * │  Client  │ ──→ │ character-anchor   │ ──→ │ character-anchor     │
 * │  (API)   │     │ routes (HTTP 엔드  │     │ service (비즈니스)   │
 * └──────────┘     │ 포인트)            │     │ + 생성 모듈          │
 *                  └────────────────────┘     └──────────────────────┘
 *                         ↓
 *                  asyncHandler, SSE
 *
 * @dependencies express, anchor-image-generator, character-anchor, logger
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  getJob,
  stopAnchorGeneration,
  getJobAnchors,
} from '../../common/services/anchor-image-generator';
import {
  startCharacterAnchorGeneration,
  setCharacterAnchor,
  getCharacterAnchor,
} from '../services/character-anchor';
import { logger } from '../../common/logger';

const router = Router();

// POST /api/characters/:charId/anchors/generate
router.post(
  '/:charId/anchors/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { count = 5, customPrompt, pulidOpts } = req.body;

    const jobId = await startCharacterAnchorGeneration(
      charId,
      count,
      customPrompt,
      pulidOpts,
    );

    res.json({ jobId });
  }),
);

// GET /api/anchors/:jobId/stream (SSE)
router.get(
  '/anchors/:jobId/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!job) {
      res.write('event: error\ndata: {"message":"Job not found"}\n\n');
      res.end();
      return;
    }

    const interval = setInterval(() => {
      const anchors = getJobAnchors(jobId);
      res.write(
        `event: anchor-progress\ndata: ${JSON.stringify({
          status: job.status,
          completed: job.completed,
          total: job.total,
          anchors,
        })}\n\n`,
      );

      if (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'stopped'
      ) {
        clearInterval(interval);
        res.end();
      }
    }, 1000);
  }),
);

// POST /api/anchors/:jobId/stop
router.post(
  '/anchors/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const success = stopAnchorGeneration(jobId);
    res.json({ success });
  }),
);

// POST /api/characters/:charId/anchor/:anchorId
router.post(
  '/:charId/anchor/:anchorId',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const anchorId = Number(req.params.anchorId);

    await setCharacterAnchor(charId, anchorId);

    res.json({ charId, anchorId });
  }),
);

// GET /api/characters/:charId/anchor
router.get(
  '/:charId/anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const anchor = await getCharacterAnchor(charId);

    res.json(anchor ?? null);
  }),
);

export default router;
