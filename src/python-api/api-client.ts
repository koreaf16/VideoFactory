/**
 * @module Python FastAPI HTTP 클라이언트
 * @description Python FastAPI 서버(localhost:8000)와 HTTP로 통신하는 클라이언트.
 *              GET/POST 요청, 헬스체크, 타임아웃 처리를 제공한다.
 *
 * ┌──────────────┐  HTTP  ┌──────────────┐
 * │ Node.js      │ ─────→ │ Python       │
 * │ ApiClient    │        │ FastAPI      │
 * │ (이 모듈)    │ ←───── │ (:8000)      │
 * └──────────────┘        └──────────────┘
 *       ↑
 * ┌──────────────┐
 * │ endpoints/   │
 * │ (script,     │
 * │  tts, etc.)  │
 * └──────────────┘
 *
 * @dependencies config, logger
 * @author AI Video Factory
 */

import { config } from '../config';
import { logger } from '../common/logger';
import type { HealthResponse, PythonApiResponse } from './types/api-response.types';

const DEFAULT_TIMEOUT_MS = 30_000;

class PythonApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = config.pythonApi.baseUrl;
    this.timeoutMs = timeoutMs;
  }

  /** GET 요청 */
  async get<T>(path: string): Promise<PythonApiResponse<T>> {
    return this.request<T>(path, { method: 'GET' });
  }

  /** POST 요청 */
  async post<T>(path: string, body: unknown): Promise<PythonApiResponse<T>> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** 헬스체크 — Python API 서버 상태 확인 */
  async checkHealth(): Promise<HealthResponse> {
    const url = `${this.baseUrl}/health`;
    logger.debug('Python API 헬스체크', { url });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`헬스체크 실패: ${response.status} ${response.statusText}`);
      }

      return response.json() as Promise<HealthResponse>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Python API 헬스체크 실패', { error: message });
      throw err;
    }
  }

  /* ─── Private ─── */

  private async request<T>(path: string, options: RequestInit): Promise<PythonApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    logger.debug('Python API 요청', { method: options.method, url });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Python API 에러 응답', {
          status: response.status,
          body: errorText,
        });
        return { success: false, error: `${response.status}: ${errorText}` };
      }

      return response.json() as Promise<PythonApiResponse<T>>;
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      logger.error('Python API 요청 실패', {
        url,
        error: isAbort ? '타임아웃' : message,
      });
      return { success: false, error: isAbort ? '요청 타임아웃' : message };
    }
  }
}

export const pythonApi = new PythonApiClient();
