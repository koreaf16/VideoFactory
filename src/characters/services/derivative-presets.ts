/**
 * @module 파생 이미지 프리셋 및 유틸
 * @description 파생 이미지 생성에 사용되는 포즈/표정 프리셋과 외모 추출 유틸리티
 * @author AI Video Factory
 */

// ─── 인터페이스 ────────────────────────────────────────────

export interface DerivativePreset {
  label: string;
  promptSuffix: string;
  skipSimilarity?: boolean;
}

export interface DerivativeResult {
  refId?: number;
  imagePath: string;
  label: string;
  prompt: string;
  seed: number;
  distance?: number;
  skipSimilarity?: boolean;
}

export interface DerivativeJob {
  jobId: string;
  charId: string;
  anchorPath: string;
  status: 'preparing' | 'generating' | 'filtering' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  generated: number;
  deleted: number;
  batch: number;
  currentStep: string;
  results: DerivativeResult[];
  shouldStop?: boolean;
}

// ─── 설정 상수 ──────────────────────────────────────────

export const FACE_SIMILARITY_THRESHOLD = 0.4;

// ─── 파생 포즈/표정 프리셋 ──────────────────────────────

/**
 * 프리셋이 포즈/표정/구도/배경을 완전히 제어한다.
 * Kontext edit에서는 "same character, <promptSuffix>" 형태로 사용.
 */
export const DERIVATIVE_PRESETS: DerivativePreset[] = [
  {
    label: '정면 미소',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, head and shoulders portrait, front view, facing camera, (gentle smile:1.3), (plain white background:1.8), (studio soft lighting:1.5), simple background',
  },
  {
    label: '정면 진지',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, head and shoulders portrait, front view, facing camera, (serious expression:1.6), (neutral face:1.5), (no smile:1.5), (closed mouth:1.4), (plain white background:1.8), (studio soft lighting:1.5), simple background',
  },
  {
    label: '45도 미소',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, (three quarter view:1.5), (face turned 45 degrees right:1.4), soft smile, (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '45도 놀람',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, (three quarter view:1.5), (face turned 45 degrees left:1.4), (surprised expression:1.6), (open mouth:1.4), (wide eyes:1.5), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '측면 프로필',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, (perfect side profile:1.6), (face turned 90 degrees:1.5), (showing ear:1.3), showing nose silhouette, (plain white background:1.8), (studio lighting:1.5), simple background',
    skipSimilarity: true,
  },
  {
    label: '살짝 고개숙임',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, front view, (head tilted down:1.5), (looking up through lashes:1.4), (shy expression:1.4), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '웃음 클로즈업',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, (extreme close-up face:1.6), (face only:1.4), (bright laugh:1.5), (eyes closed from laughing:1.4), showing teeth, (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '화난 표정',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, head and shoulders, front view, (angry expression:1.7), (furrowed eyebrows:1.5), (intense glare:1.5), (frowning:1.5), (no smile:1.6), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '슬픈 표정',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, head and shoulders, front view, (sad expression:1.7), (downcast eyes:1.5), (tearful:1.4), (pouting:1.4), (no smile:1.6), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '윙크',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, front view, (winking one eye:1.6), (one eye closed:1.5), (playful expression:1.4), (peace sign:1.3), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '뒷모습',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, (from behind:1.7), (back of head:1.6), (back view:1.6), (showing back:1.5), showing hair from back, (plain white background:1.8), (studio lighting:1.5), simple background',
    skipSimilarity: true,
  },
  {
    label: '전신 정면',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, (full body:1.6), (standing straight:1.4), arms at sides, front view, facing camera, (head to toe visible:1.5), (feet visible:1.3), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '전신 측면',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, (full body:1.6), (side view:1.5), (profile:1.4), standing, (head to toe visible:1.5), (feet visible:1.3), (plain white background:1.8), (studio lighting:1.5), simple background',
    skipSimilarity: true,
  },
  {
    label: '상반신 팔짱',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, upper body, front view, (arms crossed:1.6), (crossed arms:1.5), (confident smirk:1.4), (plain white background:1.8), (studio lighting:1.5), simple background',
  },
  {
    label: '클로즈업 눈',
    promptSuffix:
      '(masterpiece:1.2), 1girl, solo, (extreme close-up:1.6), (detailed eyes:1.6), (iris detail:1.5), (eyelashes:1.4), (eyes only:1.4), upper face only, (plain white background:1.8), (studio lighting:1.5), simple background',
    skipSimilarity: true,
  },
];

// ─── 외모 전용 프롬프트 추출 ─────────────────────────────

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
