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

/**
 * K-pop 아이돌 스타일 앵커 프롬프트.
 *
 * 추천 프롬프트 예시 (charTags에 캐릭터 외모 반영):
 *   RAW photo, 1girl, 20 years old, beautiful Korean kpop idol,
 *   V-line jawline, glass skin, dewy complexion, big round eyes,
 *   double eyelids, aegyo sal, gradient cherry lips, straight eyebrows,
 *   long flowing black hair, see-through bangs, Korean idol makeup,
 *   [의상 묘사], studio lighting, gray background, sharp focus, 8k, photorealistic
 */
export const ANCHOR_STYLE = {
  positive:
    'RAW photo, sharp focus, 8k, photorealistic, highly detailed skin texture, visible pores, distinct facial features, 85mm lens, professional photography',
  negative:
    'ugly, deformed, bad anatomy, bad proportions, rough skin, blemish, acne, wide jaw, square jaw, pale lips, thick eyebrows, oily skin, low quality, blurry, disfigured, cinematic lighting, dramatic shadows, rim lighting, neon lights, backlight, sun flare, golden hour, warm light, colored lighting, lens flare, volumetric light, god rays, bokeh, depth of field, blurry background',
};
