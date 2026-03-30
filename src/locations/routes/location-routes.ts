/**
 * @module 장소 API 라우터
 * @description 장소 CRUD, 후보 조회/좋아요/앵커 설정 API.
 *
 * @dependencies express, location-queries, db
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import locationCandidateRoutes from './location-candidate-routes';
import locationDerivativeRoutes from './location-derivative-routes';
import locationLoraRoutes from './location-lora-routes';
import { startLocDerivativeGeneration } from '../services/location-derivative-generator';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  listLocations,
  findLocationById,
  insertLocation,
  deleteLocation,
} from '../../db/queries/location-queries';
import {
  listLocCandidatesByJob,
  getLatestLocJob,
  toggleLocCandidateLike,
  setLocAnchorCandidate,
  countLocRefImages,
  getLocAnchorPath,
} from '../../db/queries/location-candidate-queries';

const router = Router();

// ─── 장소 목록/상세 ──────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const conn = await getConnection();
    try {
      const rows = await listLocations(conn);
      const withMeta = await Promise.all(
        rows.map(async (r) => {
          const latestJobId = await getLatestLocJob(conn, r.LOCATION_ID);
          const refImageCount = await countLocRefImages(conn, r.LOCATION_ID);
          const anchorPath = await getLocAnchorPath(conn, r.LOCATION_ID);
          return {
            ...r,
            LATEST_JOB_ID: latestJobId,
            REF_IMAGE_COUNT: refImageCount,
            ANCHOR_PATH: anchorPath,
          };
        }),
      );
      res.json({ success: true, data: withMeta });
    } finally {
      await conn.close();
    }
  }),
);

router.get(
  '/:locationId',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const conn = await getConnection();
    try {
      const row = await findLocationById(conn, locationId);
      if (!row) {
        res.status(404).json({ success: false, error: '장소를 찾을 수 없습니다' });
        return;
      }
      res.json({ success: true, data: row });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 장소 등록 ────────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const locationId = body.locationId as string | undefined;
    const name = body.name as string | undefined;
    if (!locationId || !name) {
      res.status(400).json({ success: false, error: 'locationId와 name은 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      await insertLocation(conn, {
        locationId,
        name,
        nameEn: (body.nameEn as string) || null,
        locationType: (body.locationType as string) || null,
        promptBase: (body.promptBase as string) || null,
        description: (body.description as string) || null,
      });
      res.json({ success: true });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 장소 삭제 ────────────────────────────────────────────

router.delete(
  '/:locationId',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const conn = await getConnection();
    try {
      const exists = await findLocationById(conn, locationId);
      if (!exists) {
        res.status(404).json({ success: false, error: '장소를 찾을 수 없습니다' });
        return;
      }
      await deleteLocation(conn, locationId);
      res.json({ success: true });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 후보 조회 ────────────────────────────────────────────

router.get(
  '/candidates/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const conn = await getConnection();
    try {
      const rows = await listLocCandidatesByJob(conn, jobId);
      if (rows.length === 0) {
        res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
        return;
      }
      const locationId = rows[0].LOCATION_ID;
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
      res.json({
        success: true,
        data: {
          jobId,
          locationId,
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

// ─── 좋아요/앵커 ─────────────────────────────────────────

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
      const newValue = await toggleLocCandidateLike(conn, candidateId);
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
      await setLocAnchorCandidate(conn, anchorCandidateId);
      const candidates = await listLocCandidatesByJob(conn, String(req.params.jobId));
      const anchor = candidates.find((c) => c.CANDIDATE_ID === anchorCandidateId);
      if (anchor) {
        // location_type을 'anchor_set'으로 변경
        await conn.execute(
          'UPDATE locations SET location_type = :lt WHERE location_id = :lid',
          { lt: 'anchor_set', lid: anchor.LOCATION_ID },
          { autoCommit: true },
        );
      }
      let derivJobId: string | null = null;
      if (anchor) {
        const loc = await findLocationById(conn, anchor.LOCATION_ID);
        derivJobId = startLocDerivativeGeneration(
          anchor.LOCATION_ID,
          anchor.IMAGE_PATH,
          loc?.PROMPT_BASE ?? undefined,
        );
      }
      res.json({ success: true, derivativeJobId: derivJobId });
    } finally {
      await conn.close();
    }
  }),
);

router.use('/', locationCandidateRoutes);
router.use('/', locationDerivativeRoutes);
router.use('/', locationLoraRoutes);

export default router;
