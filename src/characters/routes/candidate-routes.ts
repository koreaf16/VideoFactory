/**
 * @module 후보 이미지 좋아요/앵커 라우터
 * @description 후보 이미지의 좋아요 토글과 앵커 설정 API.
 *
 * @dependencies express, db queries
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  toggleCandidateLike,
  setAnchorCandidate,
  listCandidatesByJob,
} from '../../db/queries/candidate-queries';
import { updateCharacterStatus } from '../../db/queries/character-queries';
import { startDerivativeGeneration } from '../services/derivative-generator';
import { getJob, stopCandidateGeneration } from '../services/candidate-generator';
import { logger } from '../../common/logger';

const router = Router();

// ─── SSE: 후보 생성 실시간 ──────────────────────────────────

router.get(
  '/candidates/:jobId/stream',
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
      const conn = await getConnection();
      try {
        const rows = await listCandidatesByJob(conn, jobId);
        const candidates = rows.map((r) => ({
          candidateId: r.CANDIDATE_ID,
          imagePath: r.IMAGE_PATH,
          prompt: r.PROMPT_TEXT ?? '',
          seed: r.SEED ?? 0,
          qualityScore: r.QUALITY_SCORE ?? undefined,
          grade: r.GRADE ?? undefined,
          liked: r.LIKED === 1,
          isAnchor: r.IS_ANCHOR === 1,
          jobId: r.JOB_ID,
        }));
        const charId = rows[0]?.CHAR_ID ?? '';
        res.write(
          `data: ${JSON.stringify({
            jobId,
            charId,
            status: 'completed',
            total: rows.length,
            completed: rows.length,
            candidates,
          })}\n\n`,
        );
      } finally {
        await conn.close();
      }
      res.end();
      return;
    }

    const sendState = (): void => {
      res.write(
        `data: ${JSON.stringify({
          jobId: job.jobId,
          status: job.status,
          total: job.total,
          completed: job.completed,
          candidates: job.candidates,
        })}\n\n`,
      );
    };

    sendState();
    const timer = setInterval(() => {
      sendState();
      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(timer);
        res.end();
      }
    }, 2000);

    req.on('close', () => {
      clearInterval(timer);
    });
  }),
);

// ─── 후보 생성 중단 ───────────────────────────────────────

router.post(
  '/candidates/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const stopped = stopCandidateGeneration(jobId);

    if (!stopped) {
      res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
      return;
    }

    res.json({ success: true, message: '후보 생성 중단 요청 완료' });
  }),
);

// ─── 좋아요/앵커 ───────────────────────────────────────────

router.post(
  '/candidates/:jobId/like',
  asyncHandler(async (req: Request, res: Response) => {
    const { candidateId } = req.body as { candidateId: number };
    if (!candidateId) {
      res.status(400).json({ success: false, error: 'candidateId는 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      const newValue = await toggleCandidateLike(conn, candidateId);
      res.json({ success: true, liked: newValue });
    } finally {
      await conn.close();
    }
  }),
);

router.post(
  '/candidates/:jobId/anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const { anchorCandidateId } = req.body as { anchorCandidateId: number };
    if (!anchorCandidateId) {
      res.status(400).json({ success: false, error: 'anchorCandidateId는 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      await setAnchorCandidate(conn, anchorCandidateId);
      const candidates = await listCandidatesByJob(conn, String(req.params.jobId));
      const anchor = candidates.find((c) => c.CANDIDATE_ID === anchorCandidateId);
      if (anchor) {
        await updateCharacterStatus(conn, anchor.CHAR_ID, 'anchor_set');
      }

      let derivJobId: string | null = null;
      if (anchor) {
        const basePrompt = anchor.PROMPT_TEXT ?? '';
        derivJobId = startDerivativeGeneration(anchor.CHAR_ID, anchor.IMAGE_PATH, basePrompt);
        logger.info('앵커 확정 → 파생 생성 시작', {
          charId: anchor.CHAR_ID,
          anchorCandidateId,
          derivJobId,
        });
      }

      res.json({ success: true, derivativeJobId: derivJobId });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
