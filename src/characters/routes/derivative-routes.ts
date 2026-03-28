/**
 * @module 파생 이미지 + SSE 라우터
 * @description 파생 이미지 생성/조회/스트리밍 + 후보 SSE/중단 API.
 *
 * @dependencies derivative-generator, candidate-generator
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { listCandidatesByJob } from '../../db/queries/candidate-queries';
import { getJob, stopCandidateGeneration } from '../services/candidate-generator';
import {
  startDerivativeGeneration,
  getDerivativeJob,
  derivativeEvents,
  stopDerivativeGeneration,
} from '../services/derivative-generator';

const router = Router();

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

// ─── 생성 작업 중단 ───────────────────────────────────────

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

export default router;
