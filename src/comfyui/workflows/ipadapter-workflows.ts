/**
 * @module IP-Adapter 파생 워크플로우
 * @description SDXL + IP-Adapter를 사용한 얼굴 참조 파생 이미지 워크플로우
 *
 * @dependencies comfyui.types, logger
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';

// ─── 설정 ────────────────────────────────────────────────

const SDXL_NEGATIVE =
  '2girls, multiple people, crowd, group, ugly, deformed, noisy, blurry, low contrast, low quality, worst quality, jpeg artifacts, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed, disfigured, watermark, text, signature, cropped, duplicate, clone';

const IPADAPTER_DEFAULTS = {
  checkpoint: 'RealVisXL_V5.0_fp16.safetensors',
  ipadapterModel: 'ip-adapter-plus-face_sdxl_vit-h.safetensors',
  clipVision: 'clip_vision_h.safetensors',
  weight: 0.85,
  weightType: 'ease out',
  embedsScaling: 'K+V w/ C penalty',
  endAt: 0.85,
  steps: 30,
  cfg: 5.5,
  width: 768,
  height: 1024,
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
} as const;

// ─── 인터페이스 ──────────────────────────────────────────

/** IP-Adapter 파생 워크플로우 옵션 */
export interface DerivativeWorkflowOptions {
  prompt: string;
  negativePrompt?: string;
  anchorImagePath: string;
  seed: number;
  weight?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
}

// ─── 워크플로우 빌더 ────────────────────────────────────

/**
 * IP-Adapter 파생 이미지 워크플로우를 생성한다.
 * 앵커 이미지의 얼굴을 참조하여 다른 포즈/표정 이���지를 생성.
 */
function resolveDefaults(opts: DerivativeWorkflowOptions): {
  w: number;
  h: number;
  steps: number;
  cfg: number;
  weight: number;
  prefix: string;
  negative: string;
} {
  return {
    w: opts.width ?? IPADAPTER_DEFAULTS.width,
    h: opts.height ?? IPADAPTER_DEFAULTS.height,
    steps: opts.steps ?? IPADAPTER_DEFAULTS.steps,
    cfg: opts.cfg ?? IPADAPTER_DEFAULTS.cfg,
    weight: opts.weight ?? IPADAPTER_DEFAULTS.weight,
    prefix: opts.filenamePrefix ?? 'deriv_candidate',
    negative: opts.negativePrompt ? `${SDXL_NEGATIVE}, ${opts.negativePrompt}` : SDXL_NEGATIVE,
  };
}

export function buildDerivativeWorkflow(opts: DerivativeWorkflowOptions): ComfyUIWorkflow {
  const { w, h, steps, cfg, weight, prefix, negative } = resolveDefaults(opts);
  const D = IPADAPTER_DEFAULTS;

  logger.debug('IP-Adapter 파생 워크플로우 생성', {
    seed: opts.seed,
    width: w,
    height: h,
    weight,
    anchor: opts.anchorImagePath,
  });

  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: D.checkpoint } },
    '2': { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: D.ipadapterModel } },
    '3': { class_type: 'CLIPVisionLoader', inputs: { clip_name: D.clipVision } },
    '4': { class_type: 'LoadImage', inputs: { image: opts.anchorImagePath, upload: 'image' } },
    '5': {
      class_type: 'IPAdapterAdvanced',
      inputs: {
        weight,
        weight_type: D.weightType,
        combine_embeds: 'concat',
        start_at: 0.0,
        end_at: D.endAt,
        embeds_scaling: D.embedsScaling,
        model: ['1', 0],
        ipadapter: ['2', 0],
        image: ['4', 0],
        clip_vision: ['3', 0],
      },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['1', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    '8': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '9': {
      class_type: 'KSampler',
      inputs: {
        model: ['5', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['8', 0],
        seed: opts.seed,
        steps,
        cfg,
        sampler_name: D.sampler,
        scheduler: D.scheduler,
        denoise: 1.0,
      },
    },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['1', 2] } },
    '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: prefix } },
  };
}
