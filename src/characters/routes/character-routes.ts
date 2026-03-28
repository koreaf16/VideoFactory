/**
 * @module 캐릭터 API 라우터
 * @description 캐릭터 CRUD, 후보 생성/조회/좋아요/앵커 설정 API.
 *
 * ┌──────────┐     ┌──────────────┐     ┌───────────────────┐
 * │  Client  │ ──→ │  character   │ ──→ │ candidate-generator│
 * │  (API)   │     │  routes      │     │ / DB queries       │
 * └──────────┘     └──────────────┘     └───────────────────┘
 *
 * @dependencies express, candidate-generator, db queries
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  findCharacterById,
  listCharacters,
  updateCharacterStatus,
} from '../../db/queries/character-queries';
import {
  toggleCandidateLike,
  setAnchorCandidate,
  listCandidatesByJob,
  getLatestJobByChar,
} from '../../db/queries/candidate-queries';
import {
  startCandidateGeneration,
  getJob,
  getJobCandidates,
} from '../services/candidate-generator';
import { startDerivativeGeneration } from '../services/derivative-generator';
import { logger } from '../../common/logger';
import type { CandidateGenerateRequest } from '../types/character.types';
import derivativeRoutes from './derivative-routes';

const router = Router();

// 파생/SSE/중단 라우트를 합체
router.use('/', derivativeRoutes);

// ─── 캐릭터 목록/상세 ──────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const conn = await getConnection();
    try {
      const rows = await listCharacters(conn);
      const withJobs = await Promise.all(
        rows.map(async (r) => {
          const latestJobId = await getLatestJobByChar(conn, r.CHAR_ID as string);
          return { ...r, LATEST_JOB_ID: latestJobId };
        }),
      );
      res.json({ success: true, data: withJobs });
    } finally {
      await conn.close();
    }
  }),
);

router.get(
  '/:charId',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const conn = await getConnection();
    try {
      const row = await findCharacterById(conn, charId);
      if (!row) {
        res.status(404).json({ success: false, error: '캐릭터를 찾을 수 없습니다' });
        return;
      }
      res.json({ success: true, data: row });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 후보 생성/조회 ────────────────────────────────────────

router.post(
  '/generate-candidates',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CandidateGenerateRequest;
    if (!body.charId) {
      res.status(400).json({ success: false, error: 'charId는 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      const exists = await findCharacterById(conn, body.charId);
      if (!exists) {
        res.status(404).json({ success: false, error: '캐릭터를 찾을 수 없습니다' });
        return;
      }
    } finally {
      await conn.close();
    }

    const count = body.count ?? 10;
    const customPrompt = (req.body as Record<string, unknown>).prompt as string | undefined;
    const jobId = await startCandidateGeneration(body.charId, count, customPrompt);
    logger.info('후보 생성 API 호출', {
      charId: body.charId,
      count,
      jobId,
      custom: !!customPrompt,
    });

    res.json({ success: true, jobId, status: 'generating' });
  }),
);

router.get(
  '/candidates/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);

    if (job) {
      res.json({
        success: true,
        data: {
          jobId: job.jobId,
          charId: job.charId,
          status: job.status,
          total: job.total,
          completed: job.completed,
          candidates: getJobCandidates(jobId),
        },
      });
      return;
    }

    const conn = await getConnection();
    try {
      const rows = await listCandidatesByJob(conn, jobId);
      if (rows.length === 0) {
        res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
        return;
      }
      const charId = rows[0].CHAR_ID;
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
      res.json({
        success: true,
        data: {
          jobId,
          charId,
          status: 'completed',
          total: rows.length,
          completed: rows.length,
          candidates,
        },
      });
    } finally {
      await conn.close();
    }
  }),
);

router.get(
  '/candidates/:jobId/status',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
      return;
    }

    res.json({
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        total: job.total,
        completed: job.completed,
      },
    });
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
