/**
 * @module 장소 프롬프트 헬퍼
 * @description 장소 배경 후보 생성용 프롬프트 변형 상수 및 빌더.
 *
 * @author AI Video Factory
 */

// ─── 프롬프트 상수 ────────────────────────────────────────

const NO_PEOPLE_SUFFIX = ', no people, no characters, unoccupied, photorealistic, 8k';

export const INDOOR_SUFFIX = NO_PEOPLE_SUFFIX + ', detailed interior photography';
export const OUTDOOR_SUFFIX = NO_PEOPLE_SUFFIX + ', detailed architectural photography';

export const INDOOR_VARIATIONS = [
  '',
  ', wide angle shot',
  ', centered composition',
  ', natural lighting from windows',
  ', warm ambient lighting',
  ', slightly different angle',
  ', soft shadows, even lighting',
  ', clear details on walls and floor',
  ', showing full room layout',
  ', detailed textures on furniture',
];

export const OUTDOOR_VARIATIONS = [
  '',
  ', wide angle shot',
  ', centered composition',
  ', golden hour natural lighting',
  ', bright daylight',
  ', slightly different angle',
  ', dramatic sky',
  ', panoramic view',
  ', looking out over the cityscape',
  ', showing full open space',
];

const OUTDOOR_KEYWORDS = [
  'outdoor',
  'exterior',
  'rooftop',
  'terrace',
  'balcony',
  'garden',
  'park',
  'street',
  'alley',
  'beach',
  'forest',
  'mountain',
  'river',
  'lake',
  'pool',
  'courtyard',
  'patio',
  'sidewalk',
  'plaza',
  'field',
  'sky',
  '야외',
  '옥상',
  '테라스',
  '발코니',
  '정원',
  '공원',
  '거리',
  '골목',
  '해변',
  '숲',
  '산',
  '강',
  '호수',
  '수영장',
  '마당',
  '광장',
];

// ─── 헬퍼 함수 ────────────────────────────────────────────

export function isOutdoorPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return OUTDOOR_KEYWORDS.some((kw) => lower.includes(kw));
}

export function buildLocPrompts(base: string, count: number): { prompt: string; seed: number }[] {
  const outdoor = isOutdoorPrompt(base);
  const variations = outdoor ? OUTDOOR_VARIATIONS : INDOOR_VARIATIONS;
  const suffix = outdoor ? OUTDOOR_SUFFIX : INDOOR_SUFFIX;
  return Array.from({ length: count }, (_, i) => ({
    prompt: base + (variations[i % variations.length] || '') + suffix,
    seed: Math.floor(Math.random() * 999999999),
  }));
}

export function assignGrade(score: number): string {
  if (score >= 0.9) return 'S';
  if (score >= 0.8) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}
