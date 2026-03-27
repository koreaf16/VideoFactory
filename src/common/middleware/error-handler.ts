/**
 * @module 글로벌 에러 핸들러
 * @description Express 글로벌 에러 핸들러 미들웨어.
 *              AppError(운영 에러)와 예기치 않은 에러를 구분 처리한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ Route/MW     │ ──→ │ errorHandler │ ──→ │ JSON     │
 * │ (throw)      │     │ (분류/로깅)   │     │ Response │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies app-error, logger, config
 * @author AI Video Factory
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { config } from '../../config';
import { AppError } from '../errors/app-error';

interface ErrorResponse {
  status: 'error';
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Express 글로벌 에러 핸들러.
 * AppError 인스턴스는 운영 에러로 처리하고,
 * 그 외에는 예기치 않은 에러로 처리한다.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    handleOperationalError(err, res);
  } else {
    handleUnexpectedError(err, res);
  }
}

function handleOperationalError(err: AppError, res: Response): void {
  logger.error('운영 에러 발생', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    context: err.context,
  });

  const response: ErrorResponse = {
    status: 'error',
    message: err.message,
  };

  if (config.isDev && err.context) {
    response.context = err.context;
  }

  res.status(err.statusCode).json(response);
}

function handleUnexpectedError(err: Error, res: Response): void {
  logger.error('예기치 않은 에러 발생', {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  const response: ErrorResponse = {
    status: 'error',
    message: config.isDev ? err.message : '내부 서버 오류가 발생했습니다.',
  };

  if (config.isDev) {
    response.context = {
      name: err.name,
      stack: err.stack,
    };
  }

  res.status(500).json(response);
}
