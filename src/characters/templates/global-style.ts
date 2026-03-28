/**
 * @module 글로벌 스타일 프롬프트
 * @description Flux 2 Klein 9B 모델용 공통 품질 프롬프트.
 *              모든 캐릭터 생성에 앞머리로 붙는다.
 *
 * ┌──────────────────┐
 * │  GLOBAL_STYLE    │──→ 모든 프롬프트 앞에 결합
 * │  GLOBAL_NEGATIVE │──→ 모든 네거티브에 결합
 * └──────────────────┘
 *
 * @dependencies 없음
 * @author AI Video Factory
 */

// ─── 전체 품질 프롬프트 (모든 생성에 공통) ──────────────────

export const GLOBAL_STYLE: string =
  'photorealistic, ultra realistic, 8k uhd, high detail, RAW photo, sharp focus, cinematic lighting, professional photography, film grain';

export const GLOBAL_NEGATIVE: string =
  'worst quality, low quality, blurry, deformed, extra limbs, bad anatomy, watermark, text, signature, ugly, duplicate, anime, cartoon, illustration, drawing, painting, 3d render, cgi';

// ─── 앵커/마스터 이미지 전용 스타일 (flat lighting, 증명사진) ──

export const ANCHOR_STYLE = {
  positive:
    'photorealistic, ultra realistic, 8k uhd, RAW photo, sharp focus, flat studio lighting, soft even light, no harsh shadows, extremely bright and clear, plain solid light gray background, highly detailed skin texture, visible pores, distinct facial features, 85mm lens, professional photography',
  negative:
    'cinematic lighting, dramatic shadows, rim lighting, neon lights, backlight, sun flare, golden hour, warm light, colored lighting, lens flare, volumetric light, god rays, dappled light, bokeh, depth of field, blurry background',
};
