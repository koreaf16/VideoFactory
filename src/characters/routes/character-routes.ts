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
  insertCharacter,
  deleteCharacter,
} from '../../db/queries/character-queries';
import { logger } from '../../common/logger';
import derivativeRoutes from './derivative-routes';
import galleryRoutes from './gallery-routes';

const router = Router();

// 파생/SSE/중단 라우트를 합체
router.use('/', derivativeRoutes);

// 갤러리 API 라우트
router.use('/', galleryRoutes);

// ─── 캐릭터 생성 ──────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const charId = body.charId as string | undefined;
    const name = body.name as string | undefined;
    if (!charId || !name) {
      res.status(400).json({ success: false, error: 'charId와 name은 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      const exists = await findCharacterById(conn, charId);
      if (exists) {
        res.status(409).json({ success: false, error: '이미 존재하는 charId입니다' });
        return;
      }

      await insertCharacter(conn, {
        charId,
        name,
        nameEn: (body.nameEn as string) || null,
        role: (body.role as string) || null,
        charType: (body.charType as string) || null,
        profile: body.profile ? JSON.stringify(body.profile) : null,
        appearance: body.appearance ? JSON.stringify(body.appearance) : null,
        promptBase: (body.promptBase as string) || null,
        voiceConfig: null,
        mood: null,
        loraPath: null,
      });
      logger.info('캐릭터 생성 API', { charId, name });
      res.json({ success: true, charId });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 캐릭터 목록/상세 ──────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const conn = await getConnection();
    try {
      const rows = await listCharacters(conn);
      res.json({ success: true, data: rows });
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

// ─── 캐릭터 삭제 ──────────────────────────────────────────

router.delete(
  '/:charId',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const conn = await getConnection();
    try {
      const exists = await findCharacterById(conn, charId);
      if (!exists) {
        res.status(404).json({ success: false, error: '캐릭터를 찾을 수 없습니다' });
        return;
      }
      await deleteCharacter(conn, charId);
      res.json({ success: true });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
