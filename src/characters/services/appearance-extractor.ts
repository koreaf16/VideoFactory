/**
 * @module 외모 프롬프트 추출기
 * @description 프롬프트에서 외모 관련 토큰만 추출 (포즈/배경/품질 태그 제거)
 *
 * @dependencies 없음
 * @author AI Video Factory
 */

// ─── 제거 대상 키워드 ──────────────────────────────────

const REMOVE_KEYWORDS = [
  'smile',
  'smiling',
  'radiant smile',
  'gentle smile',
  'bright smile',
  'laughing',
  'grinning',
  'serious',
  'angry',
  'sad',
  'surprised',
  'crying',
  'winking',
  'pouting',
  'frowning',
  'neutral face',
  'no smile',
  'open mouth',
  'closed mouth',
  'bright radiant',
  'selfie',
  'self shot',
  'self-shot',
  'front view',
  'side view',
  'back view',
  'three quarter view',
  'profile view',
  'facing camera',
  'looking at camera',
  'looking at viewer',
  'looking up',
  'looking down',
  'looking away',
  'head tilt',
  'arms crossed',
  'arms at sides',
  'standing',
  'sitting',
  'walking',
  'running',
  'peace sign',
  'v sign',
  'waving',
  'pointing',
  'full body',
  'upper body',
  'half body',
  'head shot',
  'close-up',
  'close up',
  'closeup',
  'portrait',
  'cowboy shot',
  'bust shot',
  'from above',
  'from below',
  'from behind',
  'from side',
  'head and shoulders',
  'background',
  'cherry blossom',
  'sakura',
  'outdoor',
  'indoor',
  'forest',
  'city',
  'street',
  'classroom',
  'office',
  'beach',
  'sunset',
  'sunrise',
  'golden hour',
  'soft lighting',
  'studio lighting',
  'studio light',
  'natural lighting',
  'dramatic lighting',
  'rim lighting',
  'trees',
  'sky',
  'clouds',
  'garden',
  'park',
  'cafe',
  'restaurant',
  'room',
  'night',
  'day',
  'selfie stick',
  'holding phone',
  'holding smartphone',
  'holding camera',
  'phone camera',
  'smartphone',
  'taking selfie',
  'taking photo',
  'vlogging',
  'vlog',
  'recording',
  'filming',
  'masterpiece',
  'best quality',
  'high quality',
  'ultra detailed',
  'highres',
  'absurdres',
  '8k',
  '1girl',
  '1boy',
  'solo',
];

// ─── 공개 API ──────────────────────────────────────────

/** 프롬프트에서 외모 관련 토큰만 추출 (포즈/배경/품질 태그 제거) */
export function extractAppearanceOnly(prompt: string): string {
  const tokens = prompt
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const filtered = tokens.filter((token) => {
    const plain = token.replace(/\(([^)]+):[0-9.]+\)/g, '$1').toLowerCase();
    return !REMOVE_KEYWORDS.some((kw) => plain.includes(kw));
  });
  return filtered.join(', ');
}
