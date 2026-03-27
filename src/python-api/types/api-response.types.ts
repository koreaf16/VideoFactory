/**
 * @module Python API 응답 타입
 * @description Python FastAPI 서버 응답의 공통 타입을 정의한다.
 *              모든 엔드포인트는 PythonApiResponse<T> 형식으로 응답한다.
 *
 * ┌──────────────┐     ┌──────────────┐
 * │ FastAPI      │ ──→ │ PythonApi    │
 * │ Response     │     │ Response<T>  │
 * │ (JSON)       │     │ (타입 안전)   │
 * └──────────────┘     └──────────────┘
 *
 * @dependencies none
 * @author AI Video Factory
 */

/** Python FastAPI 공통 응답 래퍼 */
export interface PythonApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** GET /health 응답 */
export interface HealthResponse {
  status: string;
  version: string;
  services: Record<string, boolean>;
}
