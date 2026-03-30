/**
 * @module Kontext 앵커/편집 ComfyUI 워크플로우 빌더
 * @description Flux Kontext Dev 모델을 사용한 앵커(텍스트→이미지) 및 편집(이미지→이미지) 워크플로우를 생성한다.
 *
 * Anchor Node Graph (text-to-image):
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] CLIPTextEncode ──→ [5] FluxGuidance ──→ [7] KSampler
 *   [6] EmptyLatentImage ──→ [7] KSampler
 *   [7] KSampler ──→ [8] VAEDecode ──→ [9] SaveImage
 *
 * Edit Node Graph (image-to-image, ReferenceLatent):
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] LoadImage ──→ [5] VAEEncode ──→ ref LATENT
 *   [6] CLIPTextEncode ──→ [7] FluxGuidance ──→ [8] ReferenceLatent ──→ [10] KSampler
 *   [9] EmptyLatentImage ──→ [10] KSampler(denoise:1.0, cfg:1.0)
 *   [10] KSampler ──→ [11] VAEDecode ──→ [12] SaveImage
 *
 * @dependencies comfyui.types, common/logger
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';

// ─── Kontext 기본값 ──────────────────────────────────

export const KONTEXT_DEFAULTS = {
  /** Kontext 모델 — 이미지 편집(img2img) 전용 */
  unet: 'flux1-dev-kontext_fp8_scaled.safetensors',
  /** 일반 Flux Dev — 텍스트→이미지 생성 & PuLID 용 */
  unetFluxDev: 'FLUX1\\flux1-dev-fp8.safetensors',
  vae: 'ae.safetensors',
  clipL: 'clip_l.safetensors',
  t5xxl: 't5xxl_fp8_e4m3fn.safetensors',
  width: 1024,
  height: 1024,
  /** 텍스트→이미지 앵커 생성용 스텝 */
  anchorSteps: 28,
  /** 이미지 편집용 스텝 */
  editSteps: 28,
  /** Flux KSampler cfg — Flux는 항상 1.0 (guidance는 FluxGuidance 노드로 제어) */
  cfg: 1.0,
  /** 앵커 생성 FluxGuidance 값 */
  anchorGuidance: 3.5,
  /** 편집 FluxGuidance 값 — 높을수록 프롬프트 반영 강화, 낮을수록 앵커 보존 */
  editGuidance: 5.0,
  sampler: 'euler',
  scheduler: 'simple',
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
  guidance?: number;
  filenamePrefix?: string;
}

/** PuLID + Kontext 앵커 워크플로우 옵션 (레퍼런스 기반) */
export interface PulidAnchorOptions {
  referenceImageName: string;
  prompt: string;
  seed: number;
  pulidStrength?: number;
  width?: number;
  height?: number;
  steps?: number;
  guidance?: number;
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

/** Flux Dev img2img 워크플로우 옵션 (장소 앵글 변형용) */
export interface FluxImg2ImgOptions {
  anchorImageName: string;
  prompt: string;
  seed: number;
  /** 0.0(원본유지) ~ 1.0(완전재생성), 기본 0.65 */
  denoise?: number;
  guidance?: number;
  steps?: number;
  filenamePrefix?: string;
}

// ─── 공통 로더 노드 빌더 ─────────────────────────────

/**
 * UNETLoader + DualCLIPLoader + VAELoader 노드 3개를 생성한다 (ID: 1, 2, 3).
 * @param useFluxDev true이면 일반 Flux Dev 모델 사용 (txt2img, PuLID용).
 *                   false(기본)이면 Kontext 모델 사용 (img2img 편집용).
 */
function buildLoaderNodes(useFluxDev: boolean = false): Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
> {
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: useFluxDev ? KONTEXT_DEFAULTS.unetFluxDev : KONTEXT_DEFAULTS.unet,
        weight_dtype: 'default',
      },
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

// ─── 앵커 워크플로우 빌더 ────────────────────────────

/**
 * Kontext 앵커 워크플로우를 생성한다 (텍스트→이미지).
 * FluxGuidance 노드로 guidance를 주입 (KSampler cfg는 1.0 고정).
 */
export function buildKontextAnchorWorkflow(opts: KontextAnchorOptions): ComfyUIWorkflow {
  const width = opts.width ?? KONTEXT_DEFAULTS.width;
  const height = opts.height ?? KONTEXT_DEFAULTS.height;
  const steps = opts.steps ?? KONTEXT_DEFAULTS.anchorSteps;
  const guidance = opts.guidance ?? KONTEXT_DEFAULTS.anchorGuidance;
  const prefix = opts.filenamePrefix ?? KONTEXT_DEFAULTS.filenamePrefix;

  logger.debug('Flux Dev 앵커 워크플로우 생성', {
    seed: opts.seed,
    width,
    height,
    steps,
    guidance,
    promptLength: opts.prompt.length,
  });

  return {
    ...buildLoaderNodes(true),
    '4': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['2', 0] } },
    '5': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['5', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed: opts.seed,
        steps,
        cfg: KONTEXT_DEFAULTS.cfg,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  };
}

// ─── 편집 워크플로우 빌더 ────────────────────────────

/**
 * Kontext 편집 워크플로우를 생성한다 (이미지→이미지).
 *
 * FluxGuidance → ReferenceLatent 체인으로 앵커 이미지 identity를 유지하며 편집:
 * - FluxGuidance: Flux 전용 guidance 주입 (KSampler cfg는 1.0 고정)
 * - ReferenceLatent: text conditioning에 앵커 latent를 reference로 결합
 * - EmptyLatentImage에서 순수 노이즈로 시작 (denoise=1.0)
 */
export function buildKontextEditWorkflow(opts: KontextEditOptions): ComfyUIWorkflow {
  const steps = opts.steps ?? KONTEXT_DEFAULTS.editSteps;
  const guidance = opts.guidanceScale ?? KONTEXT_DEFAULTS.editGuidance;
  const prefix = opts.filenamePrefix ?? 'kontext_edit';

  logger.debug('Kontext 편집 워크플로우 생성', {
    seed: opts.seed,
    steps,
    guidance,
    anchor: opts.anchorImageName,
    editPrompt: opts.editPrompt.substring(0, 120),
  });

  return {
    ...buildLoaderNodes(),
    '4': { class_type: 'LoadImage', inputs: { image: opts.anchorImageName, upload: 'image' } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['3', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: opts.editPrompt, clip: ['2', 0] } },
    '7': { class_type: 'FluxGuidance', inputs: { conditioning: ['6', 0], guidance } },
    '8': { class_type: 'ReferenceLatent', inputs: { conditioning: ['7', 0], latent: ['5', 0] } },
    '9': {
      class_type: 'EmptyLatentImage',
      inputs: { width: KONTEXT_DEFAULTS.width, height: KONTEXT_DEFAULTS.height, batch_size: 1 },
    },
    '10': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['8', 0],
        negative: ['8', 0],
        latent_image: ['9', 0],
        seed: opts.seed,
        steps,
        cfg: KONTEXT_DEFAULTS.cfg,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } },
  };
}

// ─── Flux Dev img2img 워크플로우 빌더 (장소 앵글 변형) ──

/**
 * Flux Dev img2img 워크플로우를 생성한다 (장소 앵글 변형용).
 *
 * 앵커 이미지를 VAEEncode → KSampler latent_image로 사용하고,
 * denoise(기본 0.65)로 부분 재생성하여 장소 분위기를 유지하면서 앵글을 변경한다.
 * ReferenceLatent를 사용하지 않으므로 뷰포인트 변경이 가능하다.
 *
 * Node Graph:
 *   [1] UNETLoader (Flux Dev) ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] LoadImage ──→ [5] VAEEncode ──→ LATENT
 *   [6] CLIPTextEncode ──→ [7] FluxGuidance ──→ [8] KSampler(denoise:0.65)
 *   [5] VAEEncode ──→ [8] KSampler(latent_image)
 *   [8] KSampler ──→ [9] VAEDecode ──→ [10] SaveImage
 */
export function buildFluxImg2ImgWorkflow(opts: FluxImg2ImgOptions): ComfyUIWorkflow {
  const steps = opts.steps ?? KONTEXT_DEFAULTS.anchorSteps;
  const guidance = opts.guidance ?? KONTEXT_DEFAULTS.anchorGuidance;
  const denoise = opts.denoise ?? 0.65;
  const prefix = opts.filenamePrefix ?? 'flux_img2img';

  logger.debug('Flux Dev img2img 워크플로우 생성 (장소 앵글 변형)', {
    seed: opts.seed,
    steps,
    guidance,
    denoise,
    anchor: opts.anchorImageName,
    promptLength: opts.prompt.length,
  });

  return {
    ...buildLoaderNodes(true),
    '4': { class_type: 'LoadImage', inputs: { image: opts.anchorImageName, upload: 'image' } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['3', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['2', 0] } },
    '7': { class_type: 'FluxGuidance', inputs: { conditioning: ['6', 0], guidance } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['7', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
        seed: opts.seed,
        steps,
        cfg: KONTEXT_DEFAULTS.cfg,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: prefix } },
  };
}

// ─── PuLID 앵커 워크플로우 빌더 ─────────────────────────

/**
 * PuLID + Kontext 앵커 워크플로우를 생성한다 (레퍼런스 얼굴 → 신규 캐릭터).
 *
 * Node Graph:
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] LoadImage (레퍼런스)
 *   [5] PuLIDFluxModelLoader ──→ PULIDFLUX
 *   [13] PuLIDFluxEvaClipLoader ──→ EVA_CLIP
 *   [14] PuLIDFluxInsightFaceLoader ──→ FACEANALYSIS
 *   [6] ApplyPuLIDFlux (MODEL + PULIDFLUX + EVA_CLIP + FACEANALYSIS + IMAGE) ──→ MODEL
 *   [7] CLIPTextEncode ──→ [8] FluxGuidance ──→ [10] KSampler
 *   [9] EmptyLatentImage ──→ [10] KSampler
 *   [10] KSampler ──→ [11] VAEDecode ──→ [12] SaveImage
 */
export function buildPulidAnchorWorkflow(opts: PulidAnchorOptions): ComfyUIWorkflow {
  const width = opts.width ?? KONTEXT_DEFAULTS.width;
  const height = opts.height ?? KONTEXT_DEFAULTS.height;
  const steps = opts.steps ?? KONTEXT_DEFAULTS.anchorSteps;
  const guidance = opts.guidance ?? KONTEXT_DEFAULTS.anchorGuidance;
  const prefix = opts.filenamePrefix ?? 'pulid_anchor';
  const pulidStrength = opts.pulidStrength ?? 0.55;

  logger.debug('PuLID 앵커 워크플로우 생성 (Flux Dev)', {
    seed: opts.seed,
    width,
    height,
    steps,
    guidance,
    pulidStrength,
    reference: opts.referenceImageName,
  });

  return {
    ...buildLoaderNodes(true),
    '4': {
      class_type: 'LoadImage',
      inputs: { image: opts.referenceImageName, upload: 'image' },
    },
    '5': {
      class_type: 'PuLIDFluxModelLoader',
      inputs: { pulid_file: 'pulid_flux_v0.9.1.safetensors' },
    },
    '13': {
      class_type: 'PuLIDFluxEvaClipLoader',
      inputs: {},
    },
    '14': {
      class_type: 'PuLIDFluxInsightFaceLoader',
      inputs: { provider: 'CUDA' },
    },
    '6': {
      class_type: 'ApplyPuLIDFlux',
      inputs: {
        model: ['1', 0],
        pulid_flux: ['5', 0],
        eva_clip: ['13', 0],
        face_analysis: ['14', 0],
        image: ['4', 0],
        weight: pulidStrength,
        start_at: 0.0,
        end_at: 1.0,
        fusion: 'concat',
        fusion_weight_max: 1.0,
        fusion_weight_min: 0.0,
        train_step: 1000,
        use_gray: true,
      },
    },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['2', 0] } },
    '8': { class_type: 'FluxGuidance', inputs: { conditioning: ['7', 0], guidance } },
    '9': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '10': {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0],
        positive: ['8', 0],
        negative: ['8', 0],
        latent_image: ['9', 0],
        seed: opts.seed,
        steps,
        cfg: KONTEXT_DEFAULTS.cfg,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } },
  };
}
