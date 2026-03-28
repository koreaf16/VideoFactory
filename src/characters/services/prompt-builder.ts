/**
 * @module 프롬프트 빌더
 * @description 캐릭터 외모 데이터로부터 후보 프롬프트 N개를 체계적으로 생성한다.
 *              표정 x 앵글 x 조명 x 씬 조합을 순회하여 다양한 후보를 만든다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ global-style │     │ scene-types  │     │ time-weather │
 * └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
 *        │                    │                    │
 *        └────────────┬───────┴────────────────────┘
 *                     ↓
 *           ┌─────────────────┐
 *           │  prompt-builder │──→ CandidatePrompt[]
 *           └────────┬────────┘
 *                    ↑
 *        ┌───────────┴───────────┐
 *        │ character-tags        │
 *        │ negative-prompts      │
 *        └───────────────────────┘
 *
 * @dependencies global-style, scene-types, character-tags, time-weather, negative-prompts
 * @author AI Video Factory
 */

import { CharacterAppearance } from '../types/character.types';
import { GLOBAL_STYLE, ANCHOR_STYLE } from '../templates/global-style';
import { SCENE_PRESETS } from '../templates/scene-types';
import { LIGHTING_PRESETS } from '../templates/time-weather';
import { buildCharacterTags, buildExpressionTag, buildAngleTag } from '../templates/character-tags';
import { buildNegativePrompt } from '../templates/negative-prompts';

// ─── 후보 프롬프트 인터페이스 ───────────────────────────────

export interface CandidatePrompt {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly seed: number;
  readonly expression: string;
  readonly angle: string;
  readonly lighting: string;
  readonly scene: string;
}

// ─── 조합 요소 상수 ────────────────────────────────────────

const EXPRESSIONS: readonly string[] = ['smile', 'serious', 'surprised', 'angry', 'neutral'];
const ANGLES: readonly string[] = ['front', 'quarter', 'side'];

/** 시드 최대값 (Flux 2 Klein 9B 범위) */
const MAX_SEED = 999_999_999;

// ─── 랜덤 시드 생성 ────────────────────────────────────────

function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED + 1));
}

// ─── 단일 프롬프트 조립 ────────────────────────────────────

function assemblePrompt(
  charTags: string,
  scenePrompt: string,
  expressionTag: string,
  angleTag: string,
  lightingPrompt: string,
): string {
  return [GLOBAL_STYLE, scenePrompt, charTags, expressionTag, angleTag, lightingPrompt].join(', ');
}

// ─── 메인: 후보 프롬프트 배치 생성 ──────────────────────────

/**
 * 외모 데이터로부터 count개의 후보 프롬프트를 생성한다.
 *
 * 조합 순서: 표정(5) x 앵글(3) x 조명 앞 3개(3) x 씬 앞 2개(2) = 90
 * 그 중 count개(기본 50)만 잘라서 반환한다.
 */
export function generateCandidatePrompts(
  appearance: CharacterAppearance,
  count: number = 50,
): CandidatePrompt[] {
  const charTags = buildCharacterTags(appearance);
  const negativePrompt = buildNegativePrompt({ includeFace: true, includeBody: true });

  // 조합용 부분 프리셋 (전체 중 앞쪽만 사용하여 90 조합 생성)
  const lightingSubset = LIGHTING_PRESETS.slice(0, 3);
  const sceneSubset = SCENE_PRESETS.slice(0, 2);

  const candidates: CandidatePrompt[] = [];

  for (const expression of EXPRESSIONS) {
    for (const angle of ANGLES) {
      for (const lighting of lightingSubset) {
        for (const scene of sceneSubset) {
          if (candidates.length >= count) {
            return candidates;
          }

          const expressionTag = buildExpressionTag(expression);
          const angleTag = buildAngleTag(angle);
          const prompt = assemblePrompt(
            charTags,
            scene.prompt,
            expressionTag,
            angleTag,
            lighting.prompt,
          );

          candidates.push({
            prompt,
            negativePrompt,
            seed: randomSeed(),
            expression,
            angle,
            lighting: lighting.name,
            scene: scene.name,
          });
        }
      }
    }
  }

  return candidates;
}

// ─── 앵커/마스터 이미지 전용 프롬프트 빌더 ──────────────────
//
// Gemini 조언 반영: flat lighting, 정면, 무표정/미소만, 단색 배경
// → FaceID 합성 & LoRA 학습에 최적인 "증명사진" 스타일
//

const ANCHOR_EXPRESSIONS = [
  { key: 'neutral', tags: 'calm neutral expression, relaxed face, natural look' },
  { key: 'slight_smile', tags: 'slight gentle smile, subtle smile, natural expression' },
] as const;

const ANCHOR_ANGLES = [
  { key: 'front', tags: 'front view, looking directly at camera, eye contact, centered face' },
  { key: 'slight_turn', tags: 'very slight head turn, mostly front facing, looking at camera' },
] as const;

const ANCHOR_SCENE =
  'head and shoulders portrait, centered composition, simple clean framing, extreme face detail, highly detailed skin texture, visible pores, 85mm lens';
const ANCHOR_LIGHTING =
  'flat studio lighting, soft even light, no harsh shadows, softbox lighting, extremely bright and clear';

/**
 * 앵커/마스터 이미지용 후보 프롬프트를 생성한다.
 *
 * 정면 + 무표정/미소 + flat studio lighting + 단색 배경만 사용.
 * 변형은 시드만 다르게 하여 얼굴 디테일 극대화.
 */
export function generateAnchorCandidatePrompts(
  appearance: CharacterAppearance,
  count: number = 10,
): CandidatePrompt[] {
  const charTags = buildCharacterTags(appearance);
  const baseNegative = buildNegativePrompt({ includeFace: true, includeBody: true });
  const negativePrompt = [baseNegative, ANCHOR_STYLE.negative].join(', ');

  const candidates: CandidatePrompt[] = [];

  // 표정(2) × 각도(2) = 4 조합, count에 맞게 반복
  let idx = 0;
  while (candidates.length < count) {
    const expr = ANCHOR_EXPRESSIONS[idx % ANCHOR_EXPRESSIONS.length];
    const angle = ANCHOR_ANGLES[Math.floor(idx / ANCHOR_EXPRESSIONS.length) % ANCHOR_ANGLES.length];

    const prompt = [
      ANCHOR_STYLE.positive,
      ANCHOR_SCENE,
      charTags,
      expr.tags,
      angle.tags,
      ANCHOR_LIGHTING,
    ].join(', ');

    candidates.push({
      prompt,
      negativePrompt,
      seed: randomSeed(),
      expression: expr.key,
      angle: angle.key,
      lighting: 'studio_flat',
      scene: 'master_portrait',
    });

    idx += 1;
  }

  return candidates;
}
