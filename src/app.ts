/**
 * @module Express 앱 설정
 * @description Express 앱을 구성하고 미들웨어, 라우트를 등록한다.
 *
 * ┌──────────┐     ┌────────────────┐     ┌──────────────┐
 * │  Client  │ ──→ │  Middleware     │ ──→ │   Routes     │
 * │ (Browser)│     │ (logger,json)  │     │ (web, api)   │
 * └──────────┘     └────────────────┘     └──────────────┘
 *       │                                        │
 *       └──────── Error Handler ←────────────────┘
 *
 * @dependencies express, express-ejs-layouts
 * @author AI Video Factory
 */

import express from 'express';
import path from 'path';
import expressEjsLayouts from 'express-ejs-layouts';

import { requestLogger } from './common/middleware/request-logger';
import { errorHandler } from './common/middleware/error-handler';

import webRoutes from './web/routes/web-routes';
import characterRoutes from './characters/routes/character-routes';
import loraRoutes from './characters/routes/lora-routes';
import locationRoutes from './locations/routes/location-routes';
import episodeRoutes from './episodes/routes/episode-routes';
import videoRoutes from './video/routes/video-routes';
import healthRoutes from './web/routes/health-routes';

// ─── Express 앱 생성 ────────────────────────────────────────

const app = express();

// ─── 뷰 엔진 설정 ──────────────────────────────────────────

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'web/views'));
app.use(expressEjsLayouts);
app.set('layout', 'layouts/layout');

// ─── 정적 파일 ──────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'web/public')));
app.use('/exports', express.static(path.join(__dirname, '..', 'exports')));

// ─── 바디 파싱 ──────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── 요청 로깅 ──────────────────────────────────────────────

app.use(requestLogger);

// ─── 라우트 등록 ────────────────────────────────────────────

app.use('/', webRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/characters', loraRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/episodes', episodeRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/health', healthRoutes);

// ─── 글로벌 에러 핸들러 ─────────────────────────────────────

app.use(errorHandler);

export default app;
