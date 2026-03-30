/**
 * @module 장소 앵커 라우트
 * @description 장소 앵커 이미지 생성/관리 API
 *
 * ┌──────────┐     ┌────────────────────┐     ┌──────────────────────┐
 * │  Client  │ ──→ │ location-anchor    │ ──→ │ location-anchor      │
 * │  (API)   │     │ routes (HTTP 엔드  │     │ service (비즈니스)   │
 * └──────────┘     │ 포인트)            │     │ + 생성 모듈          │
 *                  └────────────────────┘     └──────────────────────┘
 *                         ↓
 *                  asyncHandler
 *
 * @dependencies express, anchor-image-generator, location-anchor, logger
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
  startLocationAnchorGeneration,
  setLocationAnchor,
  getLocationAnchor,
} from '../services/location-anchor';

const router = Router();

// POST /api/locations/:locationId/anchors/generate
router.post(
  '/:locationId/anchors/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const { count = 5, customPrompt, pulidOpts } = req.body;

    const jobId = await startLocationAnchorGeneration(
      locationId,
      count,
      customPrompt,
      pulidOpts,
    );

    res.json({ jobId });
  }),
);

// POST /api/locations/:locationId/anchor/:anchorId
router.post(
  '/:locationId/anchor/:anchorId',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const anchorId = Number(req.params.anchorId);

    await setLocationAnchor(locationId, anchorId);

    res.json({ locationId, anchorId });
  }),
);

// GET /api/locations/:locationId/anchor
router.get(
  '/:locationId/anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const anchor = await getLocationAnchor(locationId);

    res.json(anchor ?? null);
  }),
);

export default router;
