/**
 * @module Oracle DB 에러
 * @description Oracle 26ai 데이터베이스 연결/쿼리 중 발생하는 에러.
 *              oraCode를 포함하여 Oracle 에러 코드를 추적할 수 있다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ Oracle       │ ──→ │ OracleError  │ ──→ │ AppError │
 * │ Connection   │     │ (503)        │     │ (base)   │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies app-error
 * @author AI Video Factory
 */

import { logger } from '../logger';
import { AppError } from './app-error';

export class OracleError extends AppError {
  public readonly oraCode: number | undefined;

  constructor(
    message: string,
    oraCode?: number,
    statusCode: number = 503,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, true, {
      ...context,
      oraCode,
    });

    this.oraCode = oraCode;

    logger.error('Oracle DB 오류 발생', {
      oraCode: oraCode ?? 'unknown',
      message,
    });
  }
}
