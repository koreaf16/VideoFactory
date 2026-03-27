/**
 * @module 네거티브 프롬프트 컬렉션
 * @description 품질 저하 요소를 제거하기 위한 네거티브 프롬프트 모음.
 *              얼굴/신체 전용 네거티브를 선택적으로 조합할 수 있다.
 *
 * ┌───────────────────┐
 * │  NEGATIVE_BASE    │──→ 기본 (항상 포함)
 * │  NEGATIVE_FACE    │──→ 얼굴 전용
 * │  NEGATIVE_BODY    │──→ 신체 전용
 * └────────┬──────────┘
 *          ↓
 *  buildNegativePrompt() 로 조합
 *
 * @dependencies 없음
 * @author AI Video Factory
 */

import { GLOBAL_NEGATIVE } from './global-style';

// ─── 네거티브 프롬프트 상수 ─────────────────────────────────

/** 기본 네거티브 (= GLOBAL_NEGATIVE) */
export const NEGATIVE_BASE: string = GLOBAL_NEGATIVE;

/** 얼굴 전용 네거티브 */
export const NEGATIVE_FACE: string =
  'cross-eyed, asymmetric eyes, deformed face, bad teeth, distorted pupils, missing teeth';

/** 신체 전용 네거티브 */
export const NEGATIVE_BODY: string =
  'extra fingers, missing fingers, fused fingers, extra arms, extra legs, missing limbs, bad hands, malformed hands';

// ─── 옵션 인터페이스 ───────────────────────────────────────

interface NegativePromptOptions {
  readonly includeFace?: boolean;
  readonly includeBody?: boolean;
}

// ─── 네거티브 프롬프트 빌더 ─────────────────────────────────

/**
 * 옵션에 따라 네거티브 프롬프트를 조합한다.
 * 기본값: 얼굴/신체 모두 미포함 (BASE만).
 */
export function buildNegativePrompt(options?: NegativePromptOptions): string {
  const parts: string[] = [NEGATIVE_BASE];

  if (options?.includeFace) {
    parts.push(NEGATIVE_FACE);
  }
  if (options?.includeBody) {
    parts.push(NEGATIVE_BODY);
  }

  return parts.join(', ');
}
