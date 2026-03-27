/**
 * @module HTTP 서버 시작점
 * @description Express 앱을 HTTP 서버로 기동하고 DB 풀을 초기화한다.
 *              SIGTERM/SIGINT 시 graceful shutdown을 수행한다.
 *
 * ┌──────────┐     ┌──────────┐     ┌──────────┐
 * │  initDB  │ ──→ │  listen  │ ──→ │  Ready   │
 * │  (pool)  │     │  (port)  │     │  (serve) │
 * └──────────┘     └──────────┘     └──────────┘
 *                       │
 *            SIGTERM ──→ graceful shutdown
 *
 * @dependencies express, oracledb, config
 * @author AI Video Factory
 */

import http from 'http';
import app from './app';
import { config } from './config';
import { logger } from './common/logger';
import { initPool, closePool } from './db/connection';

const server = http.createServer(app);

async function startServer(): Promise<void> {
  await initPool();

  server.listen(config.server.port, () => {
    logger.info('서버 시작', {
      port: config.server.port,
      comfyuiUrl: config.comfyui.httpUrl,
      pythonApiUrl: config.pythonApi.baseUrl,
      oracleDsn: config.oracle.dsn,
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} 수신 — 서버 종료 시작`);

  server.close(() => {
    logger.info('HTTP 서버 종료 완료');
  });

  try {
    await closePool();
  } catch {
    logger.error('DB 풀 종료 중 오류 발생');
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('서버 시작 실패', { error: message });
  process.exit(1);
});
