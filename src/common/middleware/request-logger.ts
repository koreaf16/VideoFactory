/**
 * @module 요청 로거 미들웨어
 * @description HTTP 요청의 메서드, URL, 상태 코드, 응답 시간을 로깅한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ HTTP Request │ ──→ │ requestLogger│ ──→ │  Logger  │
 * │              │     │ (측정/기록)   │     │  (info)  │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies express, logger
 * @author AI Video Factory
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

/**
 * Express 미들웨어: 요청/응답을 로깅한다.
 * 응답 완료 시 메서드, URL, 상태 코드, 소요 시간을 기록한다.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;

    logger.info('HTTP 요청 처리', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${duration}ms`,
    });
  });

  next();
}
