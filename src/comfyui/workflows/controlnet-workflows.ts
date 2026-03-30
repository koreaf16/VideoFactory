/**
 * @module ControlNet + IP-Adapter ComfyUI 워크플로우 빌더
 * @description 블렌더 depth/normal map을 사용한 ControlNet 기반 장소 이미지 생성 워크플로우.
 *
 * Candidate Node Graph (ControlNet only):
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] CLIPTextEncode ──→ [9] FluxGuidance ──→ cond
 *   [5] LoadImage (depth) ──→ depth_image
 *   [6] LoadImage (normal) ──→ normal_image
 *   [10] ControlNetLoader ──→ controlnet
 *   [7] ControlNetApplyAdvanced(cond, controlnet, depth_image, 0.8) ──→ depth_cond
 *   [8] ControlNetApplyAdvanced(depth_cond, controlnet, normal_image, 0.4) ──→ final_cond
 *   [12] EmptyLatentImage ──→ latent
 *   [11] KSampler(MODEL, final_cond, latent) ──→ samples
 *   [13] VAEDecode ──→ [14] SaveImage
 *
 * Derivative Node Graph (adds IP-Adapter):
 *   ... (all Candidate nodes above, plus:)
 *   [15] LoadImage (styleAnchor) ──→ anchor_image
 *   [16] CLIPVisionLoader ──→ clip_vision
 *   [18] IPAdapterModelLoader ──→ ipadapter_model
 *   [17] IPAdapterAdvanced(MODEL, ipadapter_model, clip_vision, anchor_image, 0.45) ──→ patched_MODEL
 *   [11] KSampler now uses patched_MODEL from [17]
 *
 * @dependencies comfyui.types, kontext-workflows (KONTEXT_DEFAULTS)
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';
import { KONTEXT_DEFAULTS } from './kontext-workflows';

// ─── ControlNet 기본값 ───────────────────────────────

export const CONTROLNET_DEFAULTS = {
  controlnetModel: 'instantx-flux-controlnet-union.safetensors',
  ipAdapterModel: 'ip-adapter_flux.safetensors',
  clipVisionModel: 'clip-vit-large-patch14.safetensors',
  depthStrength: 0.8,
  normalStrength: 0.4,
  ipAdapterStrength: 0.45,
  steps: 28,
  guidance: 3.5,
  width: 1024,
  height: 1024,
  filenamePrefix: 'controlnet_loc',
} as const;

// ─── 인터페이스 ──────────────────────────────────────

/** ControlNet 앵커 후보 생성 워크플로우 옵션 */
export interface ControlNetCandidateOptions {
  readonly depthMapName: string;
  readonly normalMapName: string;
  readonly prompt: string;
  readonly seed: number;
  readonly depthStrength?: number;
  readonly normalStrength?: number;
  readonly width?: number;
  readonly height?: number;
  readonly filenamePrefix?: string;
}

/** ControlNet + IP-Adapter 파생 이미지 생성 워크플로우 옵션 */
export interface ControlNetDerivativeOptions extends ControlNetCandidateOptions {
  readonly styleAnchorName: string;
  readonly ipAdapterStrength?: number;
}

// ─── 공통 로더 노드 빌더 ─────────────────────────────

/**
 * UNETLoader + DualCLIPLoader + VAELoader 노드 3개를 생성한다 (ID: 1, 2, 3).
 * Flux Dev 모델을 사용한다 (ControlNet은 txt2img 파이프라인).
 */
function buildLoaderNodes(): Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
> {
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: KONTEXT_DEFAULTS.unetFluxDev,
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

// ─── ControlNet 후보 워크플로우 빌더 ─────────────────

/**
 * ControlNet (Depth + Normal) 앵커 후보 워크플로우를 생성한다.
 *
 * 블렌더로 렌더링한 depth/normal map을 ControlNetApplyAdvanced로 적용하여
 * 장소의 공간 구조를 유지한 이미지를 생성한다.
 */
export function buildControlNetCandidateWorkflow(
  opts: ControlNetCandidateOptions,
): ComfyUIWorkflow {
  const width = opts.width ?? CONTROLNET_DEFAULTS.width;
  const height = opts.height ?? CONTROLNET_DEFAULTS.height;
  const depthStrength = opts.depthStrength ?? CONTROLNET_DEFAULTS.depthStrength;
  const normalStrength = opts.normalStrength ?? CONTROLNET_DEFAULTS.normalStrength;
  const prefix = opts.filenamePrefix ?? CONTROLNET_DEFAULTS.filenamePrefix;

  logger.debug('ControlNet 후보 워크플로우 생성', {
    seed: opts.seed,
    width,
    height,
    depthStrength,
    normalStrength,
    depthMap: opts.depthMapName,
    normalMap: opts.normalMapName,
    promptLength: opts.prompt.length,
  });

  return {
    ...buildLoaderNodes(),
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.prompt, clip: ['2', 0] },
    },
    '9': {
      class_type: 'FluxGuidance',
      inputs: { conditioning: ['4', 0], guidance: CONTROLNET_DEFAULTS.guidance },
    },
    '5': {
      class_type: 'LoadImage',
      inputs: { image: opts.depthMapName, upload: 'image' },
    },
    '6': {
      class_type: 'LoadImage',
      inputs: { image: opts.normalMapName, upload: 'image' },
    },
    '10': {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: CONTROLNET_DEFAULTS.controlnetModel },
    },
    '7': {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['9', 0],
        negative: ['9', 0],
        control_net: ['10', 0],
        image: ['5', 0],
        strength: depthStrength,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    },
    '8': {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['7', 0],
        negative: ['7', 1],
        control_net: ['10', 0],
        image: ['6', 0],
        strength: normalStrength,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    },
    '12': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '11': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['8', 0],
        negative: ['8', 1],
        latent_image: ['12', 0],
        seed: opts.seed,
        steps: CONTROLNET_DEFAULTS.steps,
        cfg: KONTEXT_DEFAULTS.cfg,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '13': {
      class_type: 'VAEDecode',
      inputs: { samples: ['11', 0], vae: ['3', 0] },
    },
    '14': {
      class_type: 'SaveImage',
      inputs: { images: ['13', 0], filename_prefix: prefix },
    },
  };
}

// ─── ControlNet + IP-Adapter 파생 워크플로우 빌더 ────

/**
 * ControlNet + IP-Adapter 파생 이미지 워크플로우를 생성한다.
 *
 * 앵커 후보 워크플로우에 IP-Adapter를 추가하여 스타일 앵커 이미지의
 * 색감/분위기를 유지하면서 다양한 앵글 변형 이미지를 생성한다.
 */
export function buildControlNetDerivativeWorkflow(
  opts: ControlNetDerivativeOptions,
): ComfyUIWorkflow {
  const ipAdapterStrength = opts.ipAdapterStrength ?? CONTROLNET_DEFAULTS.ipAdapterStrength;
  const prefix = opts.filenamePrefix ?? CONTROLNET_DEFAULTS.filenamePrefix;

  logger.debug('ControlNet + IP-Adapter 파생 워크플로우 생성', {
    seed: opts.seed,
    ipAdapterStrength,
    styleAnchor: opts.styleAnchorName,
    depthMap: opts.depthMapName,
    normalMap: opts.normalMapName,
    promptLength: opts.prompt.length,
  });

  // Build candidate workflow first, then override KSampler to use patched model
  const candidateWorkflow = buildControlNetCandidateWorkflow({ ...opts, filenamePrefix: prefix });

  // Override KSampler node '11' to use patched model from IPAdapterAdvanced '17'
  const ksampler = candidateWorkflow['11'];
  const updatedKsampler = {
    ...ksampler,
    inputs: {
      ...ksampler.inputs,
      model: ['17', 0],
    },
  };

  return {
    ...candidateWorkflow,
    '11': updatedKsampler,
    '15': {
      class_type: 'LoadImage',
      inputs: { image: opts.styleAnchorName, upload: 'image' },
    },
    '16': {
      class_type: 'CLIPVisionLoader',
      inputs: { clip_name: CONTROLNET_DEFAULTS.clipVisionModel },
    },
    '18': {
      class_type: 'IPAdapterModelLoader',
      inputs: { ipadapter_file: CONTROLNET_DEFAULTS.ipAdapterModel },
    },
    '17': {
      class_type: 'IPAdapterAdvanced',
      inputs: {
        model: ['1', 0],
        ipadapter: ['18', 0],
        clip_vision: ['16', 0],
        image: ['15', 0],
        weight: ipAdapterStrength,
        weight_type: 'linear',
        combine_embeds: 'concat',
        start_at: 0.0,
        end_at: 1.0,
        embeds_scaling: 'V only',
      },
    },
  };
}
