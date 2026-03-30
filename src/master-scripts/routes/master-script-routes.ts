/**
 * @module 마스터 스크립트 API 라우터
 * @description 마스터 스크립트 등록, 조회, 수정 API.
 *
 * ┌──────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
 * │  Client  │ ──→ │  master-script       │ ──→ │ master-script-service     │
 * │  (API)   │     │  routes              │     │ (비즈니스 로직)            │
 * └──────────┘     └──────────────────────┘     └──────────────────────────┘
 *
 * @dependencies express, master-script-service
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  createMasterScript,
  getMasterScriptDetail,
  listAllMasterScripts,
  updateMasterScript,
} from '../services/master-script-service';
import { logger } from '../../common/logger';
import type {
  CreateMasterScriptRequest,
  UpdateMasterScriptRequest,
} from '../types/master-script.types';

const router = Router();

// ─── 마스터 스크립트 목록 ─────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const scripts = await listAllMasterScripts();
    res.json({ success: true, data: scripts });
  }),
);

// ─── 마스터 스크립트 등록 ─────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateMasterScriptRequest;
    if (!body.title) {
      res.status(400).json({ success: false, error: 'title은 필수입니다' });
      return;
    }

    const result = await createMasterScript(body);
    logger.info('마스터 스크립트 등록 API', { scriptId: result.scriptId });
    res.json({ success: true, ...result });
  }),
);

// ─── 마스터 스크립트 상세 ─────────────────────────────────

router.get(
  '/:scriptId',
  asyncHandler(async (req: Request, res: Response) => {
    const scriptId = Number(req.params.scriptId);
    try {
      const detail = await getMasterScriptDetail(scriptId);
      res.json({ success: true, data: detail });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: '마스터 스크립트를 찾을 수 없습니다' });
        return;
      }
      throw err;
    }
  }),
);

// ─── 마스터 스크립트 수정 ─────────────────────────────────

router.put(
  '/:scriptId',
  asyncHandler(async (req: Request, res: Response) => {
    const scriptId = Number(req.params.scriptId);
    const body = req.body as UpdateMasterScriptRequest;
    try {
      await updateMasterScript(scriptId, body);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: '마스터 스크립트를 찾을 수 없습니다' });
        return;
      }
      throw err;
    }
  }),
);

export default router;
