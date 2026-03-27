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
 * SDXL Node Graph (RealVisXL V5):
 *   [1] CheckpointLoaderSimple ──→ MODEL, CLIP, VAE
 *   [2] CLIPTextEncode (positive) ──→ [5] KSampler
 *   [3] CLIPTextEncode (negative) ──→ [5] KSampler
 *   [4] EmptyLatentImage ──→ [5] KSampler
 *   [5] KSampler ──→ [6] VAEDecode ──→ [7] SaveImage
 *
 * Flux Node Graph (Flux 2 Klein 9B):
 *   [1] UnetLoaderGGUF, [2] CLIPLoader, [3] VAELoader
 *   [4] CLIPTextEncode (pos), [5] CLIPTextEncode (neg)
 *   [6] CFGGuider, [7] RandomNoise, [8] KSamplerSelect
 *   [9] SamplerCustomAdvanced ──→ [10] VAEDecode ──→ [13] SaveImage
 *
 * @dependencies comfyui.types
 * @author AI Video Factory
 */

import { logger } from '../common/logger';
import type { ComfyUIWorkflow } from './types/comfyui.types';

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
  negativePrompt: '2girls, multiple people, crowd, group, ugly, deformed, noisy, blurry, low contrast, low quality, worst quality, jpeg artifacts, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed, disfigured, watermark, text, signature, cropped, duplicate, clone',
  filenamePrefix: 'sdxl_candidate',
  checkpoint: 'RealVisXL_V5.0_fp16.safetensors',
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
} as const;

/**
 * SDXL (RealVisXL V5) 워크플로우를 생성한다.
 * 네거티브 프롬프트 지원, 빠르고 인물 실사에 강함.
 */
export function buildSdxlWorkflow(opts: WorkflowOptions): ComfyUIWorkflow {
  const width = opts.width ?? SDXL_DEFAULTS.width;
  const height = opts.height ?? SDXL_DEFAULTS.height;
  const steps = opts.steps ?? SDXL_DEFAULTS.steps;
  const cfg = opts.cfg ?? SDXL_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? SDXL_DEFAULTS.filenamePrefix;
  const negative = opts.negativePrompt ?? SDXL_DEFAULTS.negativePrompt;

  logger.debug('SDXL 워크플로우 생성', {
    seed: opts.seed, width, height, steps, cfg,
    promptLength: opts.prompt.length,
  });

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: SDXL_DEFAULTS.checkpoint },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.prompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
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
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: prefix },
    },
  };
}

// ─── Flux 2 Klein 9B (기존, 텍스트/썸네일용) ──────────

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

/**
 * Flux 2 Klein 9B 워크플로우를 생성한다.
 * 텍스트 이해력이 높아 썸네일/타이틀 카드에 적합.
 */
export function buildFluxWorkflow(opts: WorkflowOptions): ComfyUIWorkflow {
  const width = opts.width ?? FLUX_DEFAULTS.width;
  const height = opts.height ?? FLUX_DEFAULTS.height;
  const steps = opts.steps ?? FLUX_DEFAULTS.steps;
  const cfg = opts.cfg ?? FLUX_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? FLUX_DEFAULTS.filenamePrefix;

  logger.debug('Flux 워크플로우 생성', {
    seed: opts.seed, width, height, steps, cfg,
    promptLength: opts.prompt.length,
  });

  return {
    '1': {
      class_type: 'UnetLoaderGGUF',
      inputs: { unet_name: FLUX_MODEL_FILES.unet },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: FLUX_MODEL_FILES.clip, type: 'flux2', device: 'default' },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: FLUX_MODEL_FILES.vae },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.prompt, clip: ['2', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.negativePrompt ?? '', clip: ['2', 0] },
    },
    '6': {
      class_type: 'CFGGuider',
      inputs: { cfg, model: ['1', 0], positive: ['4', 0], negative: ['5', 0] },
    },
    '7': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: opts.seed },
    },
    '8': {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: 'euler' },
    },
    '11': {
      class_type: 'Flux2Scheduler',
      inputs: { steps, width, height },
    },
    '12': {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '9': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['7', 0], guider: ['6', 0], sampler: ['8', 0],
        sigmas: ['11', 0], latent_image: ['12', 0],
      },
    },
    '10': {
      class_type: 'VAEDecode',
      inputs: { samples: ['9', 0], vae: ['3', 0] },
    },
    '13': {
      class_type: 'SaveImage',
      inputs: { images: ['10', 0], filename_prefix: prefix },
    },
  };
}

// ─── IP-Adapter 파생 워크플로우 (SDXL) ──────────────────

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

/**
 * IP-Adapter 파생 이미지 워크플로우를 생성한다.
 * 앵커 이미지의 얼굴을 참조하여 다른 포즈/표정 이미지를 생성.
 *
 * Node Graph:
 *   [1] CheckpointLoaderSimple ──→ MODEL, CLIP, VAE
 *   [2] IPAdapterModelLoader ──→ IPADAPTER
 *   [3] CLIPVisionLoader ──→ CLIP_VISION
 *   [4] LoadImage (anchor) ──→ IMAGE
 *   [5] IPAdapterAdvanced ──→ MODEL (adapted)
 *   [6] CLIPTextEncode (positive)
 *   [7] CLIPTextEncode (negative)
 *   [8] EmptyLatentImage
 *   [9] KSampler ──→ [10] VAEDecode ──→ [11] SaveImage
 */
export function buildDerivativeWorkflow(opts: DerivativeWorkflowOptions): ComfyUIWorkflow {
  const width = opts.width ?? IPADAPTER_DEFAULTS.width;
  const height = opts.height ?? IPADAPTER_DEFAULTS.height;
  const steps = opts.steps ?? IPADAPTER_DEFAULTS.steps;
  const cfg = opts.cfg ?? IPADAPTER_DEFAULTS.cfg;
  const weight = opts.weight ?? IPADAPTER_DEFAULTS.weight;
  const prefix = opts.filenamePrefix ?? 'deriv_candidate';
  // 기본 네거티브 + 프리셋별 추가 네거티브 합침
  const negative = opts.negativePrompt
    ? `${SDXL_DEFAULTS.negativePrompt}, ${opts.negativePrompt}`
    : SDXL_DEFAULTS.negativePrompt;

  logger.debug('파생 워크플로우 생성 (프롬프트 전용, LoRA 학습 데이터용)', {
    seed: opts.seed, width, height, promptLength: opts.prompt.length,
  });

  // IP-Adapter 제거 — 프롬프트만으로 생성
  // 얼굴 일관성은 face_recognition 클러스터링 + LoRA 학습으로 해결
  return buildSdxlWorkflow({
    prompt: opts.prompt,
    negativePrompt: negative,
    seed: opts.seed,
    width,
    height,
    steps,
    cfg,
    filenamePrefix: prefix,
  });
}

// ─── 통합 빌더 ────────────────────────────────────────

/**
 * 모델 선택에 따라 적절한 워크플로우를 생성한다.
 * 기본값: SDXL (RealVisXL V5)
 */
export function buildWorkflow(opts: WorkflowOptions): ComfyUIWorkflow {
  const model = opts.model ?? 'sdxl';
  if (model === 'flux') {
    return buildFluxWorkflow(opts);
  }
  return buildSdxlWorkflow(opts);
}
