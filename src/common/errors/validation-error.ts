/**
 * @module 유효성 검증 에러
 * @description 요청 데이터 유효성 검증 실패 시 발생하는 에러.
 *              실패한 필드 목록을 포함한다.
 *
 * ┌──────────────┐     ┌────────────────┐     ┌──────────┐
 * │ Request      │ ──→ │ Validation     │ ──→ │ AppError │
 * │ Validator    │     │ Error (400)    │     │ (base)   │
 * └──────────────┘     └────────────────┘     └──────────┘
 *
 * @dependencies app-error
 * @author AI Video Factory
 */

import { logger } from '../logger';
import { AppError } from './app-error';

export class ValidationError extends AppError {
  public readonly fields: string[] | undefined;

  constructor(
    message: string,
    fields?: string[],
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, true, {
      ...context,
      fields,
    });

    this.fields = fields;

    logger.warn('유효성 검증 실패', {
      fields: fields ?? [],
      message,
    });
  }
}
