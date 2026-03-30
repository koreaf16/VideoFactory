/**
 * @module 에피소드 API 라우터
 * @description 에피소드 등록, 조회, 수정, 씬 편집, 승인 API.
 *
 * ┌──────────┐     ┌──────────────┐     ┌──────────────────┐
 * │  Client  │ ──→ │  episode     │ ──→ │ episode-service   │
 * │  (API)   │     │  routes      │     │ (비즈니스 로직)    │
 * └──────────┘     └──────────────┘     └──────────────────┘
 *
 * @dependencies express, episode-service
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { listEpisodes } from '../../db/queries/episode-queries';
import {
  createEpisode,
  getEpisodeDetail,
  updateEpisode,
  updateScene,
  approveEpisode,
} from '../services/episode-service';
import { logger } from '../../common/logger';
import type { CreateEpisodeRequest } from '../types/episode.types';

const router = Router();

// ─── 에피소드 목록 ──────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const conn = await getConnection();
    try {
      const rows = await listEpisodes(conn);
      res.json({ success: true, data: rows });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 에피소드 등록 (일괄) ───────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateEpisodeRequest;
    if (!body.epNumber || !body.title || !body.scenes?.length) {
      res.status(400).json({ success: false, error: 'epNumber, title, scenes는 필수입니다' });
      return;
    }

    const result = await createEpisode(body);
    logger.info('에피소드 등록 API', { epId: result.epId, sceneCount: result.sceneCount });
    res.json({ success: true, ...result, status: 'draft' });
  }),
);

// ─── 에피소드 상세 ──────────────────────────────────────────

router.get(
  '/:epId',
  asyncHandler(async (req: Request, res: Response) => {
    const epId = Number(req.params.epId);
    try {
      const detail = await getEpisodeDetail(epId);
      res.json({ success: true, data: detail });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: '에피소드를 찾을 수 없습니다' });
        return;
      }
      throw err;
    }
  }),
);

// ─── 에피소드 메타 수정 ─────────────────────────────────────

router.put(
  '/:epId',
  asyncHandler(async (req: Request, res: Response) => {
    const epId = Number(req.params.epId);
    const body = req.body as Record<string, unknown>;
    await updateEpisode(epId, {
      title: (body.title as string) ?? '',
      synopsis: (body.synopsis as string) ?? null,
      decisionReasoning: (body.decisionReasoning as string) ?? null,
    });
    res.json({ success: true });
  }),
);

// ─── 씬 수정 ───────────────────────────────────────────────

router.put(
  '/:epId/scenes/:sceneId',
  asyncHandler(async (req: Request, res: Response) => {
    const sceneId = Number(req.params.sceneId);
    const body = req.body as Record<string, unknown>;
    await updateScene(sceneId, {
      description: (body.description as string) ?? null,
      script: (body.script as string) ?? null,
      promptEn: (body.promptEn as string) ?? null,
      motionPrompt: (body.motionPrompt as string) ?? null,
    });
    res.json({ success: true });
  }),
);

// ─── 승인 ───────────────────────────────────────────────────

router.post(
  '/:epId/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const epId = Number(req.params.epId);
    await approveEpisode(epId);
    res.json({ success: true, status: 'approved' });
  }),
);

export default router;
