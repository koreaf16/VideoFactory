/**
 * @module 장소 앵글 프리셋
 * @description 카메라 앵글 ID와 한국어 라벨, 재생성 힌트를 매핑한다.
 *
 * ┌──────────────┐     ┌────────────────┐
 * │ CAMERA_ANGLES│ ──→ │ LOCATION_PRESETS│
 * │  (template)  │     │  cameraId      │
 * └──────────────┘     │  angle, label  │
 *                      │  regenHint     │
 *                      └────────────────┘
 *
 * @dependencies blender-prompt
 * @author AI Video Factory
 */

import { CAMERA_ANGLES } from '../templates/blender-prompt';

export interface LocationPreset {
  readonly cameraId: string;
  readonly angle: string;
  readonly label: string;
  readonly regenHint: string;
}

export interface LocationDerivResult {
  refId?: number;
  imagePath: string;
  label: string;
  angle: string;
  prompt: string;
  seed: number;
}

export interface LocationDerivJob {
  jobId: string;
  locationId: string;
  anchorPath: string;
  /** 장소 설명 프롬프트 — txt2img 앵글 변형 생성에 사용 */
  promptBase: string;
  status: 'preparing' | 'generating' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  currentStep: string;
  results: LocationDerivResult[];
  shouldStop?: boolean;
}

export const LOCATION_PRESETS: readonly LocationPreset[] = [
  {
    cameraId: 'cam01_front',
    angle: 'front',
    label: '정면 전체',
    regenHint: 'wide angle front view, showing full room layout',
  },
  {
    cameraId: 'cam02_left45',
    angle: 'left45',
    label: '좌측 45도',
    regenHint: 'rotated 45 degrees left view',
  },
  {
    cameraId: 'cam03_right45',
    angle: 'right45',
    label: '우측 45도',
    regenHint: 'rotated 45 degrees right view',
  },
  {
    cameraId: 'cam04_reverse',
    angle: 'reverse',
    label: '역방향',
    regenHint: 'reverse view toward entrance',
  },
  {
    cameraId: 'cam05_diagonal',
    angle: 'diagonal',
    label: '대각선',
    regenHint: 'corner-to-corner diagonal view',
  },
  {
    cameraId: 'cam06_high',
    angle: 'high',
    label: '하이 앵글',
    regenHint: 'overhead high angle looking down',
  },
  {
    cameraId: 'cam07_low_up',
    angle: 'low_up',
    label: '로우 앵글',
    regenHint: 'low angle looking up toward ceiling',
  },
  {
    cameraId: 'cam08_low',
    angle: 'low',
    label: '낮은 앵글',
    regenHint: 'ground level horizontal view',
  },
  {
    cameraId: 'cam09_closeup_a',
    angle: 'closeup_a',
    label: '클로즈업 A',
    regenHint: 'close-up of main feature wall',
  },
  {
    cameraId: 'cam10_closeup_b',
    angle: 'closeup_b',
    label: '클로즈업 B',
    regenHint: 'close-up of secondary feature',
  },
  {
    cameraId: 'cam11_closeup_c',
    angle: 'closeup_c',
    label: '클로즈업 C',
    regenHint: 'close-up of furniture/central element',
  },
  {
    cameraId: 'cam12_closeup_d',
    angle: 'closeup_d',
    label: '클로즈업 D',
    regenHint: 'close-up of entrance/door area',
  },
] as const;

// Runtime validation: must stay in sync with CAMERA_ANGLES
if (LOCATION_PRESETS.length !== CAMERA_ANGLES.length) {
  throw new Error(
    `LOCATION_PRESETS length (${LOCATION_PRESETS.length}) does not match CAMERA_ANGLES length (${CAMERA_ANGLES.length})`,
  );
}

export function getPresetByCameraId(cameraId: string): LocationPreset | undefined {
  return LOCATION_PRESETS.find((p) => p.cameraId === cameraId);
}

export function getPresetByAngle(angle: string): LocationPreset | undefined {
  return LOCATION_PRESETS.find((p) => p.angle === angle);
}
