/**
 * @module LoRA 학습/추론 ComfyUI 워크플로우 빌더
 * @description Flux Kontext Dev 모델 기반 LoRA 학습(FluxTrainer) 및 추론(LoraLoader) 워크플로우를 생성한다.
 *
 * Training Node Graph:
 *   [1] FluxTrainModelSelect ──→ [3] FluxTrainSetup
 *   [2] TrainDatasetAdd ──→ [3] FluxTrainSetup
 *   [3] FluxTrainSetup ──→ [4] FluxTrainExecute
 *
 * Inference Node Graph:
 *   [1] UNETLoader ──→ [4] LoraLoader
 *   [2] VAELoader
 *   [3] DualCLIPLoader ──→ [4] LoraLoader
 *   [4] LoraLoader ──→ [5] CLIPTextEncode, [7] KSampler
 *   [5] CLIPTextEncode ──→ [7] KSampler
 *   [6] EmptyLatentImage ──→ [7] KSampler
 *   [7] KSampler ──→ [8] VAEDecode ──→ [9] SaveImage
 *
 * @dependencies comfyui.types, lora.types
 * @author AI Video Factory
 */

import type { ComfyUIWorkflow } from '../types/comfyui.types';
import type { LoraTrainingConfig } from '../../characters/types/lora.types';

// ─── 상수 ────────────────────────────────────────────

const KONTEXT_MODEL = 'flux1-kontext-dev.safetensors';

const INFERENCE_DEFAULTS = {
  vae: 'ae.safetensors',
  clipL: 'clip_l.safetensors',
  t5xxl: 't5xxl_fp8_e4m3fn.safetensors',
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 2.5,
  sampler: 'euler',
  scheduler: 'normal',
  loraStrength: 0.7,
  filenamePrefix: 'lora_test',
} as const;

// ─── 학습 워크플로우 ────────────────────────────────────

export interface LoraTrainWorkflowOptions {
  config: LoraTrainingConfig;
  datasetPath: string;
  outputDir: string;
  outputName: string;
}

/**
 * LoRA 학습 워크플로우를 생성한다 (FluxTrainer 파이프라인).
 * FluxTrainModelSelect -> TrainDatasetAdd -> FluxTrainSetup -> FluxTrainExecute
 */
export function buildLoraTrainWorkflow(opts: LoraTrainWorkflowOptions): ComfyUIWorkflow {
  const { config } = opts;

  return {
    '1': {
      class_type: 'FluxTrainModelSelect',
      inputs: { ckpt_name: KONTEXT_MODEL },
    },
    '2': {
      class_type: 'TrainDatasetAdd',
      inputs: { dataset_path: opts.datasetPath },
    },
    '3': {
      class_type: 'FluxTrainSetup',
      inputs: {
        model: ['1', 0],
        dataset: ['2', 0],
        output_dir: opts.outputDir,
        output_name: opts.outputName,
        network_dim: config.networkDim,
        network_alpha: config.networkAlpha,
        learning_rate: config.learningRate,
        lr_scheduler: config.lrScheduler,
        max_train_steps: config.maxTrainSteps,
        train_batch_size: config.trainBatchSize,
        gradient_accumulation: config.gradientAccumulation,
        mixed_precision: config.mixedPrecision,
        optimizer: config.optimizer,
        save_every_n_steps: config.saveEveryNSteps,
        seed: config.seed,
      },
    },
    '4': {
      class_type: 'FluxTrainExecute',
      inputs: { train_setup: ['3', 0] },
    },
  };
}

// ─── 추론 워크플로우 ────────────────────────────────────

export interface LoraInferenceOptions {
  loraFileName: string;
  prompt: string;
  seed: number;
  loraStrength?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
}

/**
 * LoRA 적용 추론 워크플로우를 생성한다.
 * UNETLoader + DualCLIPLoader -> LoraLoader -> CLIPTextEncode -> KSampler -> VAEDecode -> SaveImage
 */
export function buildLoraInferenceWorkflow(opts: LoraInferenceOptions): ComfyUIWorkflow {
  const strength = opts.loraStrength ?? INFERENCE_DEFAULTS.loraStrength;
  const steps = opts.steps ?? INFERENCE_DEFAULTS.steps;
  const cfg = opts.cfg ?? INFERENCE_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? INFERENCE_DEFAULTS.filenamePrefix;

  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: KONTEXT_MODEL, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'VAELoader',
      inputs: { vae_name: INFERENCE_DEFAULTS.vae },
    },
    '3': {
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: INFERENCE_DEFAULTS.clipL,
        clip_name2: INFERENCE_DEFAULTS.t5xxl,
        type: 'flux',
      },
    },
    '4': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['3', 0],
        lora_name: opts.loraFileName,
        strength_model: strength,
        strength_clip: strength,
      },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.prompt, clip: ['4', 1] },
    },
    '6': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: INFERENCE_DEFAULTS.width,
        height: INFERENCE_DEFAULTS.height,
        batch_size: 1,
      },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed: opts.seed,
        steps,
        cfg,
        sampler_name: INFERENCE_DEFAULTS.sampler,
        scheduler: INFERENCE_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['2', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: prefix },
    },
  };
}
