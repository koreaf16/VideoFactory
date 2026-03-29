/**
 * @module 장소 후보 SSE/생성 라우터
 * @description 장소 배경 후보 생성 시작, SSE 스트리밍, 중단 API.
 *
 * @dependencies express, location-candidate-generator, location-queries, db
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { listLocCandidatesByJob } from '../../db/queries/location-queries';
import {
  startLocCandidateGeneration,
  getLocJob,
  stopLocCandidateGeneration,
} from '../services/location-candidate-generator';

const router = Router();

// ─── 후보 생성 시작 ─────────────────────────────────────

router.post(
  '/generate-candidates',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const locationId = body.locationId as string | undefined;
    const count = Number(body.count ?? 30);
    const customPrompt = (body.customPrompt as string) || undefined;
    const width = Number(body.width ?? 1024);
    const height = Number(body.height ?? 1024);

    if (!locationId) {
      res.status(400).json({ success: false, error: 'locationId는 필수입니다' });
      return;
    }

    const jobId = await startLocCandidateGeneration(locationId, count, customPrompt, width, height);
    res.json({ success: true, jobId });
  }),
);

// ─── SSE: 후보 생성 실시간 ──────────────────────────────

router.get(
  '/candidates/:jobId/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getLocJob(jobId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!job) {
      const conn = await getConnection();
      try {
        const rows = await listLocCandidatesByJob(conn, jobId);
        const candidates = rows.map((r) => ({
          candidateId: r.CANDIDATE_ID,
          imagePath: r.IMAGE_PATH,
          prompt: r.PROMPT_TEXT ?? '',
          seed: r.SEED ?? 0,
          qualityScore: r.QUALITY_SCORE ?? undefined,
          liked: r.LIKED === 1,
          isAnchor: r.IS_ANCHOR === 1,
          jobId: r.JOB_ID,
        }));
        const locationId = rows[0]?.LOCATION_ID ?? '';
        res.write(
          `data: ${JSON.stringify({
            jobId,
            locationId,
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
          locationId: job.locationId,
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
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped') {
        clearInterval(timer);
        res.end();
      }
    }, 2000);

    req.on('close', () => {
      clearInterval(timer);
    });
  }),
);

// ─── 후보 생성 중단 ────────────────────────────────────

router.post(
  '/candidates/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const stopped = stopLocCandidateGeneration(jobId);
    if (!stopped) {
      res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
      return;
    }
    res.json({ success: true, message: '장소 후보 생성 중단 요청 완료' });
  }),
);

export default router;
