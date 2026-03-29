/**
 * @module 장소 앵글 변형 프리셋
 * @description 장소 배경의 다양한 앵글 변형을 위한 Kontext 편집 프롬프트.
 *
 * @author AI Video Factory
 */

export interface LocationPreset {
  label: string;
  angle: string;
  promptSuffix: string;
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
  status: 'preparing' | 'generating' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  currentStep: string;
  results: LocationDerivResult[];
  shouldStop?: boolean;
}

const ROOM_IDENTITY =
  'same room, same furniture layout, same wall colors, same decoration, empty room, no people';

export const LOCATION_PRESETS: LocationPreset[] = [
  {
    label: '정면 전체',
    angle: 'front',
    promptSuffix: `${ROOM_IDENTITY}, front view, wide angle, showing full room layout`,
  },
  {
    label: '좌측 회전',
    angle: 'left',
    promptSuffix: `${ROOM_IDENTITY}, camera rotated slightly to the left, showing more of the left wall`,
  },
  {
    label: '우측 회전',
    angle: 'right',
    promptSuffix: `${ROOM_IDENTITY}, camera rotated slightly to the right, showing more of the right wall`,
  },
  {
    label: '역방향',
    angle: 'reverse',
    promptSuffix: `${ROOM_IDENTITY}, camera is now at the back of the room looking toward the entrance door, reverse angle`,
  },
  {
    label: '대각선',
    angle: 'diagonal',
    promptSuffix: `${ROOM_IDENTITY}, camera in the corner looking diagonally across the room`,
  },
  {
    label: '위에서 내려다보기',
    angle: 'high',
    promptSuffix: `${ROOM_IDENTITY}, high angle shot looking down, bird's eye perspective`,
  },
  {
    label: '아래에서 올려다보기',
    angle: 'low_up',
    promptSuffix: `${ROOM_IDENTITY}, low angle shot looking up, dramatic perspective from below`,
  },
  {
    label: '낮은 앵글',
    angle: 'low',
    promptSuffix: `${ROOM_IDENTITY}, floor level low angle, showing furniture from ground perspective`,
  },
  {
    label: '창문 클로즈업',
    angle: 'closeup_window',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the window area, showing window frame and curtains, same lighting`,
  },
  {
    label: '벽면 클로즈업',
    angle: 'closeup_wall',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the main wall feature, showing wall details and decorations`,
  },
  {
    label: '가구 클로즈업',
    angle: 'closeup_furniture',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the main furniture piece, detailed texture, same style`,
  },
  {
    label: '입구 클로즈업',
    angle: 'closeup_entrance',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the door and entrance area, showing doorframe details`,
  },
];
