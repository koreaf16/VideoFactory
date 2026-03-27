/**
 * @module 대본 생성 API 엔드포인트
 * @description Python FastAPI의 대본 생성 엔드포인트를 호출한다.
 *              에피소드 번호, 타입, 캐릭터 등의 파라미터로 대본을 생성한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Node.js      │ ──→ │ pythonApi    │ ──→ │ Python       │
 * │ (대본 요청)   │     │ .post()     │     │ /api/script  │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies api-client
 * @author AI Video Factory
 */

import { pythonApi } from '../api-client';
import type { PythonApiResponse } from '../types/api-response.types';

/** 대본 생성 요청 파라미터 */
export interface ScriptGenerateParams {
  epNumber: number;
  epType: string;
  characters?: string[];
  previousEpisodes?: number[];
}

/** 대본 생성 결과 (Python API 응답 data) */
interface ScriptGenerateResult {
  script: string;
  scenes: unknown[];
}

/** 대본 생성 API 호출 */
export async function generateScript(
  params: ScriptGenerateParams
): Promise<PythonApiResponse<ScriptGenerateResult>> {
  return pythonApi.post<ScriptGenerateResult>('/api/script/generate', params);
}
