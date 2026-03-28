/**
 * @module 웹 페이지 라우터
 * @description EJS 뷰를 렌더링하는 HTML 페이지 라우트를 정의한다.
 *
 * ┌──────────┐     ┌──────────┐     ┌──────────┐
 * │  Browser │ ──→ │  Router  │ ──→ │  EJS     │
 * │  (GET)   │     │  (경로)  │     │  (render)│
 * └──────────┘     └──────────┘     └──────────┘
 *
 * @dependencies express
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';

const router = Router();

// ─── 대시보드 ───────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  res.render('dashboard', { title: '대시보드' });
});

// ─── 캐릭터 관리 ────────────────────────────────────────────

router.get('/characters', (_req: Request, res: Response) => {
  res.render('characters/manage', { title: '캐릭터 관리' });
});

router.get('/characters/candidates/:jobId', (req: Request, res: Response) => {
  res.render('characters/candidates', { title: '후보 선택', jobId: req.params.jobId });
});

router.get('/characters/derivatives/:jobId', (req: Request, res: Response) => {
  res.render('characters/derivatives', { title: '파생 검수', jobId: req.params.jobId });
});

router.get('/characters/lora-dataset', (_req: Request, res: Response) => {
  res.render('characters/lora-dataset', { title: 'LoRA 데이터셋' });
});

router.get('/characters/lora-training', (_req: Request, res: Response) => {
  res.render('characters/lora-training', { title: 'LoRA 학습' });
});

// ─── 에피소드 관리 ──────────────────────────────────────────

router.get('/episodes', (_req: Request, res: Response) => {
  res.render('episodes/list', { title: '에피소드 목록' });
});

router.get('/episodes/:epId/edit', (_req: Request, res: Response) => {
  res.render('episodes/editor', { title: '대본 편집' });
});

// ─── 영상 생성 큐 ───────────────────────────────────────────

router.get('/video/queue', (_req: Request, res: Response) => {
  res.render('video/queue', { title: '영상 생성 큐' });
});

export default router;
