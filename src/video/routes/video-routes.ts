/**
 * @module 영상 생성 API 라우터
 * @description 영상 생성, 상태 조회, 큐 목록 API 스켈레톤.
 *              Step 7에서 실제 구현을 추가한다.
 *
 * ┌──────────┐     ┌──────────────┐     ┌──────────┐
 * │  Client  │ ──→ │  video       │ ──→ │  501     │
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

// ─── 영상 생성/상태/큐 ─────────────────────────────────────

router.post('/episodes/:epId/generate', notImplemented);
router.get('/episodes/:epId/status', notImplemented);
router.get('/queue', notImplemented);

export default router;
