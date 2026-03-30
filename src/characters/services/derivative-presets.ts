/**
 * @module 파생 이미지 프리셋 및 유틸
 * @description 파생 이미지 생성에 사용되는 포즈/표정 프리셋
 *
 * @dependencies appearance-extractor
 * @author AI Video Factory
 */

export { extractAppearanceOnly } from './appearance-extractor';

// ─── 인터페이스 ────────────────────────────────────────────

export interface DerivativePreset {
  label: string;
  promptSuffix: string;
  skipSimilarity?: boolean;
}

export interface DerivativeResult {
  refId?: number;
  imagePath?: string;
  imageBlob: Buffer;
  label: string;
  prompt: string;
  seed: number;
  distance?: number;
  skipSimilarity?: boolean;
  isCustom?: boolean;
}

export interface DerivativeJob {
  jobId: string;
  charId: string;
  anchorBlob: Buffer;
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
 * Kontext 편집용 프리셋 — Flux T5 인코더에 맞는 자연어 프롬프트.
 * SD 가중치 문법 (tag:1.5) 사용 금지 — Flux는 자연어만 이해.
 * KontextSampler에서 앵커 이미지로 identity를 유지하므로 캐릭터 외모 기술 불필요.
 *
 * ★ 얼굴 LoRA 전용 데이터셋 — 전신/뒷모습 제외.
 *   전신 프롬프트 사용 시 몸/의상/체형은 베이스 모델이 생성하며,
 *   LoRA는 얼굴 일관성만 담당한다.
 */
export const DERIVATIVE_PRESETS: DerivativePreset[] = [
  // ─── 얼굴 클로즈업 (8~12장, 메인 데이터) ──────────────────
  //
  // Kontext 편집 프롬프트 작성 규칙:
  // 1. "Change ... to ..." 지시형 문장으로 시작 — 묘사형보다 편집 반영률이 높다
  // 2. 바꾸고 싶은 요소를 문장 앞에 배치 — T5 인코더는 앞쪽 토큰에 더 집중
  // 3. 유지할 요소(배경, 프레이밍)는 문장 뒤에 간결하게
  {
    label: '정면 미소',
    promptSuffix:
      'Change her expression to a gentle warm smile with relaxed eyes. Close-up face portrait, front view, plain white studio background, soft even lighting.',
  },
  {
    label: '정면 진지',
    promptSuffix:
      'Change her expression to serious and composed with a straight closed mouth, no smile at all, stern focused eyes. Close-up face portrait, front view, plain white studio background, soft even lighting.',
  },
  {
    label: '정면 놀람',
    promptSuffix:
      'Change her expression to shocked and surprised with wide open eyes and mouth dropped open in astonishment. Close-up face portrait, front view, plain white studio background, soft even lighting.',
  },
  {
    label: '좌측 45도 미소',
    promptSuffix:
      'Turn the face 45 degrees to the left so the right ear is hidden and the left ear is fully visible, nose pointing to the left side of the frame, with a soft smile. Close-up face portrait, plain white studio background, soft lighting.',
  },
  {
    label: '우측 45도 미소',
    promptSuffix:
      'Turn the face 45 degrees to the right so the left ear is hidden and the right ear is fully visible, nose pointing to the right side of the frame, with a soft smile. Close-up face portrait, plain white studio background, soft lighting.',
  },
  {
    label: '좌측 45도 진지',
    promptSuffix:
      'Turn the face 45 degrees to the left so the right ear is hidden and the left ear is fully visible, nose pointing to the left side of the frame, with a serious expression, no smile, stern eyes. Close-up face portrait, plain white studio background, soft lighting.',
  },
  {
    label: '측면 프로필',
    promptSuffix:
      'Turn the face fully 90 degrees to the left showing a perfect side profile, only the left ear visible, nose silhouette pointing to the left edge of the frame. Close-up face portrait, plain white studio background, soft lighting.',
    skipSimilarity: true,
  },
  {
    label: '살짝 고개숙임',
    promptSuffix:
      'Tilt her head downward slightly, looking up at the camera through her lashes with a shy demure expression. Close-up face portrait, front view, plain white studio background, soft lighting.',
  },
  {
    label: '웃음 클로즈업',
    promptSuffix:
      'Change her expression to laughing joyfully with eyes squinted nearly shut and teeth showing in a big bright laugh. Extreme close-up of face, plain white studio background, soft lighting.',
  },
  {
    label: '화난 표정',
    promptSuffix:
      'Change her expression to angry and furious with deeply furrowed eyebrows, intense glaring eyes, and a tight frown. Close-up face portrait, front view, plain white studio background, soft lighting.',
  },
  {
    label: '슬픈 표정',
    promptSuffix:
      'Change her expression to deeply sad and melancholy with downcast eyes, drooping eyelids, and a slight pout. Close-up face portrait, front view, plain white studio background, soft lighting.',
  },
  {
    label: '윙크',
    promptSuffix:
      'Change her expression to a playful wink with one eye fully closed and the other open, cheeky grin. Close-up face portrait, front view, plain white studio background, soft lighting.',
  },
  // ─── 상반신 포함 (2~3장, 의상/체형 보조용 — 품질 좋은 것만) ─
  {
    label: '정면 상반신',
    promptSuffix:
      'Zoom out to show her head and shoulders in a relaxed natural pose, arms at sides. Front view, plain white studio background, soft even lighting.',
  },
  {
    label: '45도 상반신 팔짱',
    promptSuffix:
      'Zoom out to show her upper body with arms crossed confidently, slight smirk, three-quarter angle. Plain white studio background, soft lighting.',
  },
  {
    label: '상반신 손 흔들기',
    promptSuffix:
      'Zoom out to show her upper body waving one hand cheerfully with a bright smile. Front view, plain white studio background, soft lighting.',
  },
];
