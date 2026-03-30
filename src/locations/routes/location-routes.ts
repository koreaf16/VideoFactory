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
import locationSkeletonRoutes from './location-skeleton-routes';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  listLocations,
  findLocationById,
  insertLocation,
  deleteLocation,
} from '../../db/queries/location-queries';
import {
  getLatestLocJob,
  countLocRefImages,
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
          return {
            ...r,
            LATEST_JOB_ID: latestJobId,
            REF_IMAGE_COUNT: refImageCount,
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

router.use('/', locationCandidateRoutes);
router.use('/', locationDerivativeRoutes);
router.use('/', locationLoraRoutes);
router.use('/', locationSkeletonRoutes);

export default router;
