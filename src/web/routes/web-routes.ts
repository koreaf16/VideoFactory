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

router.get('/characters/:charId/gallery', (req: Request, res: Response) => {
  res.render('characters/gallery', { title: '파생 이미지 갤러리', charId: req.params.charId });
});

router.get('/characters/lora-dataset', (_req: Request, res: Response) => {
  res.render('characters/lora-dataset', { title: 'LoRA 데이터셋' });
});

router.get('/characters/lora-training', (_req: Request, res: Response) => {
  res.render('characters/lora-training', { title: 'LoRA 학습' });
});

// ─── 장소 관리 ──────────────────────────────────────────────

router.get('/locations', (_req: Request, res: Response) => {
  res.render('locations/manage', { title: '장소 관리' });
});

router.get('/locations/blender-preview', (req: Request, res: Response) => {
  res.render('locations/blender-preview', {
    title: 'Phase 1 — 스켈레톤 생성',
    locationId: req.query.locationId ?? '',
    jobId: req.query.jobId ?? '',
  });
});

router.get('/locations/candidates/:jobId', (req: Request, res: Response) => {
  res.render('locations/candidates', { title: '장소 후보 선택', jobId: req.params.jobId });
});

router.get('/locations/derivatives/:jobId', (req: Request, res: Response) => {
  res.render('locations/derivatives', { title: '장소 변형 검수', jobId: req.params.jobId });
});

router.get('/locations/:locationId/gallery', (req: Request, res: Response) => {
  res.render('locations/gallery', { title: '장소 갤러리', locationId: req.params.locationId });
});

// ─── 에피소드 관리 ──────────────────────────────────────────

router.get('/episodes', (_req: Request, res: Response) => {
  res.render('episodes/list', { title: '에피소드 목록' });
});

router.get('/episodes/new', (_req: Request, res: Response) => {
  res.render('episodes/create', { title: '새 에피소드' });
});

router.get('/episodes/:epId/edit', (req: Request, res: Response) => {
  res.render('episodes/editor', { title: '대본 편집', epId: req.params.epId });
});

// ─── 마스터 대본 ───────────────────────────────────────────

router.get('/scripts', (_req: Request, res: Response) => {
  res.render('scripts/list', { title: '마스터 대본' });
});

router.get('/scripts/:scriptId', (req: Request, res: Response) => {
  res.render('scripts/detail', { title: '대본 상세', scriptId: req.params.scriptId });
});

// ─── 영상 생성 큐 ───────────────────────────────────────────

router.get('/video/queue', (_req: Request, res: Response) => {
  res.render('video/queue', { title: '영상 생성 큐' });
});

export default router;
