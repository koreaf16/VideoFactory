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
    '10': {
      class_type: 'DownloadAndLoadFlorence2Model',
      inputs: {
        model: 'microsoft/Florence-2-large',
        precision: 'fp16',
        attention: 'sdpa'
      }
    },
    '2': {
      class_type: 'Florence2Run',
      inputs: {
        image: ['1', 0],
        florence2_model: ['10', 0],
        text_input: '',
        task: opts.task ?? 'detailed_caption',
        fill_mask: false,
        keep_model_loaded: false,
        max_new_tokens: 512,
        num_beams: 3,
        do_sample: false,
        output_mask_select: '',
        seed: 1
      },
    },
    '3': {
      class_type: 'ShowText|pysssss',
      inputs: {
        text: ['2', 2],
      },
    },
  };
}
