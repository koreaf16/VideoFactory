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

import path from 'path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { findCharacterById, listCharacters } from '../../db/queries/character-queries';
import { listCandidatesByJob, getLatestJobByChar } from '../../db/queries/candidate-queries';
import {
  startCandidateGeneration,
  getJob,
  getJobCandidates,
} from '../services/candidate-generator';
import { logger } from '../../common/logger';
import { ensureDir } from '../../common/utils/file-utils';
import type { AnchorMode } from '../types/character.types';
import type { PulidModeOptions } from '../services/candidate-processor';
import derivativeRoutes from './derivative-routes';
import galleryRoutes from './gallery-routes';
import candidateRoutes from './candidate-routes';

// ─── Multer 설정 (레퍼런스 이미지 업로드) ──────────────────

const UPLOAD_DIR = path.resolve('uploads/references');
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await ensureDir(UPLOAD_DIR);
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `ref_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ─── 헬퍼 함수 ───────────────────────────────────────────────

async function handleGetCandidatesFromDb(jobId: string, res: Response): Promise<void> {
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
}

const router = Router();

// 파생/SSE/중단 라우트를 합체
router.use('/', derivativeRoutes);

// 갤러리 API 라우트
router.use('/', galleryRoutes);

// 후보 이미지 좋아요/앵커 라우트
router.use('/', candidateRoutes);

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
  upload.single('referenceImage'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const charId = body.charId as string | undefined;
    if (!charId) {
      res.status(400).json({ success: false, error: 'charId는 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      const exists = await findCharacterById(conn, charId);
      if (!exists) {
        res.status(404).json({ success: false, error: '캐릭터를 찾을 수 없습니다' });
        return;
      }
    } finally {
      await conn.close();
    }

    const count = Number(body.count) || 10;
    const customPrompt = (body.prompt as string) || undefined;
    const mode = (body.mode as AnchorMode) || 'prompt';

    let pulidOpts: PulidModeOptions | undefined;
    if (mode === 'reference') {
      if (!req.file) {
        res.status(400).json({ success: false, error: '레퍼런스 이미지가 필요합니다' });
        return;
      }
      pulidOpts = {
        referenceImagePath: req.file.path,
        pulidStrength: Number(body.pulidStrength) || 0.55,
        guidance: Number(body.guidance) || 3.5,
      };
    }

    const jobId = await startCandidateGeneration(charId, count, customPrompt, pulidOpts);
    logger.info('후보 생성 API 호출', { charId, count, jobId, mode, custom: !!customPrompt });

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

    await handleGetCandidatesFromDb(jobId, res);
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
      data: { jobId: job.jobId, status: job.status, total: job.total, completed: job.completed },
    });
  }),
);

export default router;
