/**
 * @module 에피소드 API 라우터
 * @description 에피소드 생성, 수정, 장면 편집 API 스켈레톤.
 *              Step 5~6에서 실제 구현을 추가한다.
 *
 * ┌──────────┐     ┌──────────────┐     ┌──────────┐
 * │  Client  │ ──→ │  episode     │ ──→ │  501     │
 * │  (API)   │     │  routes      │     │  (stub)  │
 * └──────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies express
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';

const router = Router();

const notImplemented = (_req: Request, res: Response): void => {
  res.status(501).json({ status: 'not_implemented' });
};

// ─── 에피소드 CRUD ──────────────────────────────────────────

router.post('/generate', notImplemented);
router.get('/:epId', notImplemented);
router.put('/:epId', notImplemented);

// ─── 장면 편집 ──────────────────────────────────────────────

router.put('/:epId/scenes/:sceneId', notImplemented);
router.post('/:epId/scenes/:sceneId/regenerate', notImplemented);

// ─── 승인 ───────────────────────────────────────────────────

router.post('/:epId/approve', notImplemented);

export default router;
