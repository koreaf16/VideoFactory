/**
 * @module 캐릭터 태그 빌더
 * @description DB의 CharacterAppearance JSON을 Flux 프롬프트 태그로 변환.
 *              외모, 표정, 카메라 앵글 태그를 생성한다.
 *
 * ┌───────────────────┐     ┌──────────────────┐
 * │ CharAppearance    │ ──→ │ buildCharTags()  │──→ "dark brown hair, ..."
 * │ (DB JSON)         │     │ buildExpression()│──→ "smiling, happy"
 * │                   │     │ buildAngle()     │──→ "front view, ..."
 * └───────────────────┘     └──────────────────┘
 *
 * @dependencies ../types/character.types
 * @author AI Video Factory
 */

import { CharacterAppearance } from '../types/character.types';

// ─── 표정 매핑 테이블 ──────────────────────────────────────

const EXPRESSION_MAP: Record<string, string> = {
  smile: 'genuine smile, natural happy expression, subtle laugh lines',
  serious: 'serious determined look, intense gaze, composed',
  surprised: 'surprised expression, wide eyes, slightly parted lips',
  angry: 'fierce expression, furrowed brows, intense stare',
  neutral: 'calm neutral expression, relaxed face, natural pose',
};

// ─── 카메라 앵글 매핑 테이블 ────────────────────────────────

const ANGLE_MAP: Record<string, string> = {
  front: 'front view, looking at camera, eye contact',
  quarter: 'three quarter view, slight head turn, natural angle',
  side: 'side profile, silhouette contour, editorial angle',
};

// ─── 외모 태그 조합 ────────────────────────────────────────

/**
 * DB appearance JSON을 하나의 프롬프트 문자열로 조합한다.
 * 예: "dark brown long straight hair with bangs, brown eyes, fair skin, school uniform"
 */
export function buildCharacterTags(appearance: CharacterAppearance): string {
  const parts: string[] = [
    `${appearance.hair_color} ${appearance.hair_style} hair`,
    `${appearance.eye_color} eyes`,
    `${appearance.skin_tone} skin`,
    appearance.outfit,
  ];

  if (appearance.height) {
    parts.push(appearance.height);
  }

  if (appearance.accessories) {
    parts.push(appearance.accessories);
  }

  return parts.join(', ');
}

// ─── PuLID 모드용 외모 태그 (얼굴 묘사 제외) ─────────────────

/**
 * PuLID 레퍼런스 모드용 태그 빌더.
 * 얼굴 관련 태그(머리색, 눈색, 피부톤)를 제외하고
 * 의상/체형/악세서리만 반환하여 PuLID 얼굴 반영을 방해하지 않는다.
 */
export function buildCharacterTagsForPulid(appearance: CharacterAppearance): string {
  const parts: string[] = ['1girl'];

  if (appearance.outfit) {
    parts.push(appearance.outfit);
  }
  if (appearance.height) {
    parts.push(appearance.height);
  }
  if (appearance.accessories) {
    parts.push(appearance.accessories);
  }

  return parts.join(', ');
}

// ─── 표정 태그 변환 ────────────────────────────────────────

/**
 * 표정 키워드를 프롬프트 태그로 변환한다.
 * 알 수 없는 표정은 neutral로 폴백.
 */
export function buildExpressionTag(expression: string): string {
  return EXPRESSION_MAP[expression] ?? EXPRESSION_MAP['neutral'];
}

// ─── 카메라 앵글 태그 변환 ──────────────────────────────────

/**
 * 카메라 앵글 키워드를 프롬프트 태그로 변환한다.
 * 알 수 없는 앵글은 front로 폴백.
 */
export function buildAngleTag(angle: string): string {
  return ANGLE_MAP[angle] ?? ANGLE_MAP['front'];
}
