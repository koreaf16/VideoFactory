/**
 * @module 블렌더 스크립트 생성 API 엔드포인트
 * @description Python FastAPI의 블렌더 스크립트 생성 엔드포인트를 호출한다.
 *              Claude CLI subprocess를 통해 bpy 스크립트를 생성한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Node.js      │ ──→ │ pythonApi    │ ──→ │ Python       │
 * │ (스크립트)   │     │ .post()      │     │ /api/blender │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies api-client, config
 * @author AI Video Factory
 */

import { config } from '../../config';
import { logger } from '../../common/logger';

/** 블렌더 스크립트 생성 요청 파라미터 */
export interface BlenderGenerateParams {
  description: string;
  system_prompt: string;
}

/** Python /api/blender/generate-script 응답 */
export interface BlenderGenerateResult {
  script: string;
  success: boolean;
}

// Claude CLI subprocess는 최대 120초가 걸릴 수 있으므로 넉넉하게 설정
const BLENDER_TIMEOUT_MS = 150_000;

/**
 * Python FastAPI를 통해 블렌더 bpy 스크립트를 생성한다.
 * Claude CLI subprocess를 사용하므로 타임아웃을 150초로 설정한다.
 */
export async function generateBlenderScript(
  params: BlenderGenerateParams,
): Promise<BlenderGenerateResult> {
  const url = `${config.pythonApi.baseUrl}/api/blender/generate-script`;
  logger.info('블렌더 스크립트 생성 요청', {
    url,
    descriptionLength: params.description.length,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLENDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('블렌더 스크립트 생성 API 에러', {
        status: response.status,
        body: errorText,
      });
      throw new Error(`블렌더 스크립트 생성 실패 (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as BlenderGenerateResult;
    logger.info('블렌더 스크립트 생성 완료', { scriptLength: result.script.length });
    return result;
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : String(err);
    logger.error('블렌더 스크립트 생성 API 호출 실패', {
      url,
      error: isAbort ? '타임아웃 (150초)' : message,
    });
    throw isAbort ? new Error('블렌더 스크립트 생성 타임아웃 (150초)') : err;
  }
}
