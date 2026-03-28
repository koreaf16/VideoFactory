/**
 * @module Florence-2 캡셔닝 워크플로우
 * @description 이미지를 Florence-2 모델로 자동 캡셔닝하는 ComfyUI 워크플로우.
 *
 * LoadImage -> Florence2Run -> Output text
 *
 * @author AI Video Factory
 */

import type { ComfyUIWorkflow } from '../types/comfyui.types';

export interface CaptionWorkflowOptions {
  imageName: string;
  task?: string;
}

export function buildCaptionWorkflow(opts: CaptionWorkflowOptions): ComfyUIWorkflow {
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: opts.imageName },
    },
    '2': {
      class_type: 'Florence2Run',
      inputs: {
        image: ['1', 0],
        task: opts.task ?? 'detailed_caption',
        max_new_tokens: 512,
      },
    },
  };
}
