/**
 * @module 씬 타입 프리셋
 * @description 캐릭터 포트레이트용 6가지 씬 프리셋.
 *              프롬프트 빌더에서 조합 시 하나씩 적용된다.
 *
 * ┌──────────────────────┐
 * │    ScenePreset[]     │
 * │  portrait_bust       │
 * │  portrait_full       │
 * │  action_pose         │
 * │  casual_scene        │
 * │  dramatic            │
 * │  closeup_face        │
 * └──────────┬───────────┘
 *            ↓
 *    prompt-builder 에서 선택
 *
 * @dependencies 없음
 * @author AI Video Factory
 */

// ─── 씬 프리셋 인터페이스 ──────────────────────────────────

export interface ScenePreset {
  readonly name: string;
  readonly prompt: string;
}

// ─── 6종 씬 프리셋 ─────────────────────────────────────────

export const SCENE_PRESETS: readonly ScenePreset[] = [
  { name: 'portrait_bust', prompt: 'upper body portrait, shallow depth of field, bokeh background' },
  { name: 'portrait_full', prompt: 'full body portrait, standing pose, natural environment background' },
  { name: 'action_pose', prompt: 'dynamic candid shot, motion captured, natural moment' },
  { name: 'casual_scene', prompt: 'casual lifestyle photo, warm natural atmosphere, daily life' },
  { name: 'dramatic', prompt: 'dramatic Rembrandt lighting, dark moody background, rim light' },
  { name: 'closeup_face', prompt: 'extreme close-up face, skin texture detail, catch light in eyes, 85mm lens' },
] as const;
