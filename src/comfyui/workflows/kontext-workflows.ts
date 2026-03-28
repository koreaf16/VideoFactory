/**
 * @module Kontext 앵커/편집 ComfyUI 워크플로우 빌더
 * @description Flux Kontext Dev 모델을 사용한 앵커(텍스트→이미지) 및 편집(이미지→이미지) 워크플로우를 생성한다.
 *
 * Anchor Node Graph (text-to-image):
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] CLIPTextEncode (positive) ──→ [6] KSampler
 *   [5] EmptyLatentImage ──→ [6] KSampler
 *   [6] KSampler ──→ [7] VAEDecode ──→ [8] SaveImage
 *
 * Edit Node Graph (image-to-image):
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] LoadImage ──→ [6] VAEEncode
 *   [5] CLIPTextEncode (positive) ──→ [7] KSampler
 *   [6] VAEEncode ──→ [7] KSampler
 *   [7] KSampler(denoise:0.75) ──→ [8] VAEDecode ──→ [9] SaveImage
 *
 * @dependencies comfyui.types, common/logger
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';

// ─── Kontext 기본값 ──────────────────────────────────

export const KONTEXT_DEFAULTS = {
  unet: 'flux1-kontext-dev.safetensors',
  vae: 'ae.safetensors',
  clipL: 'clip_l.safetensors',
  t5xxl: 't5xxl_fp8_e4m3fn.safetensors',
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 2.5,
  sampler: 'euler',
  scheduler: 'normal',
  filenamePrefix: 'kontext',
} as const;

// ─── 인터페이스 ──────────────────────────────────────

/** Kontext 앵커(텍스트→이미지) 워크플로우 옵션 */
export interface KontextAnchorOptions {
  prompt: string;
  seed: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
}

/** Kontext 편집(이미지→이미지) 워크플로우 옵션 */
export interface KontextEditOptions {
  anchorImageName: string;
  editPrompt: string;
  seed: number;
  guidanceScale?: number;
  steps?: number;
  filenamePrefix?: string;
}

// ─── 공통 로더 노드 빌더 ─────────────────────────────

/** UNETLoader + DualCLIPLoader + VAELoader 노드 3개를 생성한다 (ID: 1, 2, 3). */
function buildLoaderNodes(): Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
> {
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: KONTEXT_DEFAULTS.unet, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: KONTEXT_DEFAULTS.clipL,
        clip_name2: KONTEXT_DEFAULTS.t5xxl,
        type: 'flux',
      },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: KONTEXT_DEFAULTS.vae },
    },
  };
}

/** KSampler 공통 입력을 생성한다. */
function buildSamplerInputs(p: {
  positiveId: string;
  latentId: string;
  seed: number;
  steps: number;
  cfg: number;
  denoise: number;
}): Record<string, unknown> {
  return {
    model: ['1', 0],
    positive: [p.positiveId, 0],
    negative: [p.positiveId, 0],
    latent_image: [p.latentId, 0],
    seed: p.seed,
    steps: p.steps,
    cfg: p.cfg,
    sampler_name: KONTEXT_DEFAULTS.sampler,
    scheduler: KONTEXT_DEFAULTS.scheduler,
    denoise: p.denoise,
  };
}

// ─── 앵커 워크플로우 빌더 ────────────────────────────

/**
 * Kontext 앵커 워크플로우를 생성한다 (텍스트→이미지).
 * Flux 스타일로 네거티브 프롬프트 없이, positive/negative 모두 동일한 CLIPTextEncode를 참조.
 */
export function buildKontextAnchorWorkflow(opts: KontextAnchorOptions): ComfyUIWorkflow {
  const width = opts.width ?? KONTEXT_DEFAULTS.width;
  const height = opts.height ?? KONTEXT_DEFAULTS.height;
  const steps = opts.steps ?? KONTEXT_DEFAULTS.steps;
  const cfg = opts.cfg ?? KONTEXT_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? KONTEXT_DEFAULTS.filenamePrefix;

  logger.debug('Kontext 앵커 워크플로우 생성', {
    seed: opts.seed,
    width,
    height,
    steps,
    cfg,
    promptLength: opts.prompt.length,
  });

  return {
    ...buildLoaderNodes(),
    '4': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['2', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': {
      class_type: 'KSampler',
      inputs: buildSamplerInputs({
        positiveId: '4',
        latentId: '5',
        seed: opts.seed,
        steps,
        cfg,
        denoise: 1.0,
      }),
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: prefix } },
  };
}

// ─── 편집 워크플로우 빌더 ────────────────────────────

/**
 * Kontext 편집 워크플로우를 생성한다 (이미지→이미지).
 * 앵커 이미지를 로드하여 VAEEncode 후 KSampler(denoise:0.75)로 편집한다.
 */
export function buildKontextEditWorkflow(opts: KontextEditOptions): ComfyUIWorkflow {
  const steps = opts.steps ?? KONTEXT_DEFAULTS.steps;
  const cfg = opts.guidanceScale ?? KONTEXT_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? 'kontext_edit';

  logger.debug('Kontext 편집 워크플로우 생성', {
    seed: opts.seed,
    steps,
    cfg,
    anchor: opts.anchorImageName,
    promptLength: opts.editPrompt.length,
  });

  return {
    ...buildLoaderNodes(),
    '4': { class_type: 'LoadImage', inputs: { image: opts.anchorImageName, upload: 'image' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: opts.editPrompt, clip: ['2', 0] } },
    '6': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['3', 0] } },
    '7': {
      class_type: 'KSampler',
      inputs: buildSamplerInputs({
        positiveId: '5',
        latentId: '6',
        seed: opts.seed,
        steps,
        cfg,
        denoise: 0.75,
      }),
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  };
}
