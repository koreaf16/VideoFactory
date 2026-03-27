/**
 * @module 기본 애플리케이션 에러
 * @description 모든 커스텀 에러의 베이스 클래스.
 *              운영 에러와 프로그래밍 에러를 구분한다.
 *
 * ┌──────────────┐     ┌──────────────┐
 * │  AppError    │ ──→ │  Error       │
 * │ (operational)│     │  (built-in)  │
 * └──────────────┘     └──────────────┘
 *        ↑
 *   ComfyUIError, OracleError,
 *   ValidationError 등 상속
 *
 * @dependencies 없음
 * @author AI Video Factory
 */

import { logger } from '../logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    statusCode: number,
    isOperational: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    // V8 스택 트레이스에서 생성자 프레임 제거
    Error.captureStackTrace(this, this.constructor);

    logger.error(`${this.name}: ${message}`, {
      statusCode,
      isOperational,
      ...(context ?? {}),
    });
  }
}
