/**
 * @module ComfyUI 에러
 * @description ComfyUI WebSocket/HTTP 통신 중 발생하는 에러.
 *              promptId를 포함하여 실패한 프롬프트를 추적할 수 있다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ ComfyUI      │ ──→ │ ComfyUIError │ ──→ │ AppError │
 * │ Client       │     │ (502)        │     │ (base)   │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies app-error
 * @author AI Video Factory
 */

import { logger } from '../logger';
import { AppError } from './app-error';

export class ComfyUIError extends AppError {
  public readonly promptId: string | undefined;

  constructor(
    message: string,
    promptId?: string,
    statusCode: number = 502,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, true, {
      ...context,
      promptId,
    });

    this.promptId = promptId;

    logger.error('ComfyUI 오류 발생', {
      promptId: promptId ?? 'unknown',
      message,
    });
  }
}
