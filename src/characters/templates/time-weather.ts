/**
 * @module 조명/분위기 프리셋
 * @description 시간대/날씨 기반 라이팅 프리셋 5종.
 *              프롬프트 빌더에서 조합 시 분위기를 결정한다.
 *
 * ┌───────────────────────┐
 * │   LightingPreset[]    │
 * │  daylight             │
 * │  golden_hour          │
 * │  overcast             │
 * │  studio               │
 * │  night                │
 * └──────────┬────────────┘
 *            ↓
 *    prompt-builder 에서 선택
 *
 * @dependencies 없음
 * @author AI Video Factory
 */

// ─── 라이팅 프리셋 인터페이스 ───────────────────────────────

export interface LightingPreset {
  readonly name: string;
  readonly prompt: string;
}

// ─── 5종 라이팅 프리셋 ─────────────────────────────────────

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  { name: 'daylight', prompt: 'natural sunlight, bright outdoor, dappled light through trees' },
  {
    name: 'golden_hour',
    prompt: 'golden hour, warm backlight, sun flare, long shadows, magic hour',
  },
  { name: 'overcast', prompt: 'overcast soft light, diffused even lighting, no harsh shadows' },
  {
    name: 'studio',
    prompt: 'professional studio lighting, softbox, clean backdrop, fashion photography',
  },
  {
    name: 'night',
    prompt: 'low key lighting, neon ambient glow, city night atmosphere, volumetric light',
  },
  {
    name: 'studio_flat',
    prompt:
      'flat studio lighting, soft even light, no harsh shadows, softbox lighting, extremely bright and clear, white reflector fill',
  },
] as const;
