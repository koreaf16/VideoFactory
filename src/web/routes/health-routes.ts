/**
 * @module 시스템 상태 확인 라우터
 * @description 대시보드 상태 카드에서 호출하는 헬스체크 엔드포인트.
 *
 * ┌──────────┐     ┌──────────┐     ┌──────────────┐
 * │ Dashboard│ ──→ │  health  │ ──→ │ ComfyUI /    │
 * │  (JS)    │     │  routes  │     │ Python / DB  │
 * └──────────┘     └──────────┘     └──────────────┘
 *
 * @dependencies config, db/connection
 * @author AI Video Factory
 */

import { Router } from 'express';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { logger } from '../../common/logger';

const router = Router();

router.get('/comfyui', async (_req, res) => {
  try {
    const resp = await fetch(`${config.comfyui.httpUrl}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json() as { system?: { comfyui_version?: string } };
    const gpu = (data.system as Record<string, unknown>)?.gpu_name ?? 'N/A';
    res.json({
      connected: true,
      version: data.system?.comfyui_version,
      detail: `GPU: ${gpu}`,
    });
  } catch {
    logger.warn('ComfyUI 헬스체크 실패');
    res.status(503).json({ connected: false, detail: '연결 실패' });
  }
});

router.get('/python', async (_req, res) => {
  try {
    const resp = await fetch(`${config.pythonApi.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json() as { status?: string; version?: string };
    res.json({
      connected: true,
      version: data.version,
      detail: `포트: ${config.pythonApi.port} (${data.status})`,
    });
  } catch {
    logger.warn('Python API 헬스체크 실패');
    res.status(503).json({ connected: false, detail: '연결 실패' });
  }
});

router.get('/oracle', async (_req, res) => {
  try {
    const conn = await getConnection();
    try {
      await conn.execute('SELECT 1 FROM DUAL');
      res.json({
        connected: true,
        detail: `IP: ${config.oracle.dsn.split('/')[0]}`,
      });
    } finally {
      await conn.close();
    }
  } catch {
    logger.warn('Oracle 헬스체크 실패');
    res.status(503).json({ connected: false, detail: '연결 실패' });
  }
});

export default router;
