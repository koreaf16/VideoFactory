/**
 * @module ComfyUI 워크플로우 빌더
 * @description SDXL(RealVisXL V5) + Flux 2 Klein 모델용 ComfyUI API 워크플로우를 생성한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Workflow     │ ──→ │ Workflow     │ ──→ │ ComfyUI      │
 * │ Options      │     │ Builder      │     │ Client       │
 * │ (파라미터)    │     │ (JSON 생성)  │     │ (제출)       │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies comfyui.types
 * @author AI Video Factory
 */

import { logger } from '../common/logger';
import type { ComfyUIWorkflow } from './types/comfyui.types';

// re-export for backward compat
export type { DerivativeWorkflowOptions } from './workflows/ipadapter-workflows';
export { buildDerivativeWorkflow } from './workflows/ipadapter-workflows';

// ─── 공통 인터페이스 ──────────────────────────────────

/** 워크플로우 생성 옵션 */
export interface WorkflowOptions {
  prompt: string;
  negativePrompt?: string;
  seed: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
  model?: 'sdxl' | 'flux';
}

// ─── SDXL (RealVisXL V5) ─────────────────────────────

const SDXL_DEFAULTS = {
  width: 768,
  height: 1024,
  steps: 28,
  cfg: 7,
  negativePrompt:
    '2girls, multiple people, crowd, group, ugly, deformed, noisy, blurry, low contrast, low quality, worst quality, jpeg artifacts, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed, disfigured, watermark, text, signature, cropped, duplicate, clone',
  filenamePrefix: 'sdxl_candidate',
  checkpoint: 'RealVisXL_V5.0_fp16.safetensors',
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
} as const;

/** SDXL (RealVisXL V5) 워크플로우를 생성한다. */
export function buildSdxlWorkflow(opts: WorkflowOptions): ComfyUIWorkflow {
  const w = opts.width ?? SDXL_DEFAULTS.width;
  const h = opts.height ?? SDXL_DEFAULTS.height;
  const steps = opts.steps ?? SDXL_DEFAULTS.steps;
  const cfg = opts.cfg ?? SDXL_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? SDXL_DEFAULTS.filenamePrefix;
  const negative = opts.negativePrompt ?? SDXL_DEFAULTS.negativePrompt;

  logger.debug('SDXL 워크플로우 생성', {
    seed: opts.seed,
    width: w,
    height: h,
    steps,
    cfg,
    promptLength: opts.prompt.length,
  });

  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: SDXL_DEFAULTS.checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: opts.seed,
        steps,
        cfg,
        sampler_name: SDXL_DEFAULTS.sampler,
        scheduler: SDXL_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: prefix } },
  };
}

// ─── Flux 2 Klein 9B ─────────────────────────────────

const FLUX_DEFAULTS = {
  width: 768,
  height: 1024,
  steps: 4,
  cfg: 1,
  negativePrompt: '',
  filenamePrefix: 'flux_candidate',
} as const;

const FLUX_MODEL_FILES = {
  unet: 'flux-2-klein-9b-Q5_K_M.gguf',
  clip: 'qwen_3_8b_fp8mixed.safetensors',
  vae: 'flux2-vae.safetensors',
} as const;

/** Flux 2 Klein 9B 워크플로우를 생성한다. */
export function buildFluxWorkflow(opts: WorkflowOptions): ComfyUIWorkflow {
  const w = opts.width ?? FLUX_DEFAULTS.width;
  const h = opts.height ?? FLUX_DEFAULTS.height;
  const steps = opts.steps ?? FLUX_DEFAULTS.steps;
  const cfg = opts.cfg ?? FLUX_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? FLUX_DEFAULTS.filenamePrefix;

  logger.debug('Flux 워크플로우 생성', {
    seed: opts.seed,
    width: w,
    height: h,
    steps,
    cfg,
    promptLength: opts.prompt.length,
  });

  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: FLUX_MODEL_FILES.unet } },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: FLUX_MODEL_FILES.clip, type: 'flux2', device: 'default' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: FLUX_MODEL_FILES.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['2', 0] } },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.negativePrompt ?? '', clip: ['2', 0] },
    },
    '6': {
      class_type: 'CFGGuider',
      inputs: { cfg, model: ['1', 0], positive: ['4', 0], negative: ['5', 0] },
    },
    '7': { class_type: 'RandomNoise', inputs: { noise_seed: opts.seed } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '11': { class_type: 'Flux2Scheduler', inputs: { steps, width: w, height: h } },
    '12': { class_type: 'EmptyFlux2LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '9': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['7', 0],
        guider: ['6', 0],
        sampler: ['8', 0],
        sigmas: ['11', 0],
        latent_image: ['12', 0],
      },
    },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: prefix } },
  };
}

// ─── 통합 빌더 ────────────────────────────────────────

/** 모델 선택에 따라 적절한 워크플로우를 생성한다. */
export function buildWorkflow(opts: WorkflowOptions): ComfyUIWorkflow {
  const model = opts.model ?? 'sdxl';
  if (model === 'flux') return buildFluxWorkflow(opts);
  return buildSdxlWorkflow(opts);
}
