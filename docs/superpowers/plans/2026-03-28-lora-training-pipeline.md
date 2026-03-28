# LoRA 캐릭터 학습 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FLUX.1 Kontext [dev] + ComfyUI 워크플로우 기반으로 캐릭터 LoRA 학습 엔드투엔드 파이프라인을 구현한다.

**Architecture:** 기존 `src/characters/` 도메인을 확장하여 Gemini를 제거하고 Kontext로 교체한 뒤, 데이터셋 준비/캡셔닝/학습/추론 테스트 기능을 추가한다. 모든 GPU 작업은 ComfyUI 커스텀 노드(KontextWrapper, FluxTrainer, Florence2)를 통해 WebSocket API로 제어한다. 데이터는 Oracle DB에 영구 저장하고, ComfyUI 서버에는 임시 스테이징만 한다.

**Tech Stack:** TypeScript, Express, Oracle 26ai (oracledb), ComfyUI WebSocket API, EJS + Tailwind + Alpine.js

**Spec:** `docs/superpowers/specs/2026-03-28-lora-training-pipeline-design.md`

---

## 파일 구조

### 신규 파일

```
src/characters/types/lora.types.ts              LoRA 도메인 인터페이스
src/comfyui/workflows/kontext-workflows.ts      Kontext 앵커/편집 워크플로우
src/comfyui/workflows/lora-workflows.ts         LoRA 학습/추론 워크플로우
src/comfyui/workflows/caption-workflows.ts      Florence-2 캡셔닝 워크플로우
src/db/queries/lora-queries.ts                  LoRA 5개 테이블 CRUD
src/characters/services/lora-dataset.ts         데이터셋 구성 + 캡셔닝 오케스트레이션
src/characters/services/lora-training.ts        학습 실행 + 모니터링
src/characters/routes/lora-routes.ts            LoRA REST 엔드포인트
src/web/views/characters/lora-dataset.ejs       데이터셋 + 캡션 UI
src/web/views/characters/lora-training.ejs      학습 모니터 + 평가 UI
src/web/public/js/lora.js                       LoRA UI 인터랙션
tests/comfyui/kontext-workflows.test.ts         Kontext 워크플로우 단위 테스트
tests/comfyui/lora-workflows.test.ts            LoRA 워크플로우 단위 테스트
tests/characters/lora-dataset.test.ts           데이터셋 서비스 단위 테스트
```

### 수정 파일

```
src/characters/services/candidate-generator.ts  Gemini -> ComfyUI Kontext
src/characters/services/derivative-generator.ts Gemini -> ComfyUI Kontext 편집
src/characters/services/prompt-builder.ts       Kontext 프롬프트 구조로 수정
src/characters/routes/character-routes.ts       Gemini import 제거
src/comfyui/workflow-builder.ts                 기존 유지, 새 워크플로우는 별도 파일
src/config.ts                                   gemini 설정 제거
package.json                                    @google/genai 제거
src/web/routes/web-routes.ts                    LoRA UI 라우트 추가
src/web/views/layouts/sidebar.ejs               LoRA 메뉴 추가
```

### 삭제 파일

```
src/gemini/client.ts                            Gemini 클라이언트 전체
```

---

## Task 1: Gemini 제거 + Config 정리

**Files:**
- Delete: `src/gemini/client.ts`
- Modify: `src/config.ts`
- Modify: `package.json`

이 태스크는 Gemini 의존성을 완전히 제거한다. candidate-generator와 derivative-generator의 Gemini import는 Task 6, 7에서 Kontext로 교체한다.

- [ ] **Step 1: config.ts에서 gemini 블록 제거**

`src/config.ts`에서 gemini 설정 블록을 삭제한다:

```typescript
// 삭제할 부분 (62~67행):
  gemini: {
    apiKey: requireEnv('GEMINI_API_KEY', ''),
    model: optionalEnv('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image-preview'),
    imageSize: optionalEnv('GEMINI_IMAGE_SIZE', '1K') as '512' | '1K' | '2K' | '4K',
    aspectRatio: optionalEnv('GEMINI_ASPECT_RATIO', '3:4'),
  },
```

- [ ] **Step 2: src/gemini/ 디렉토리 삭제**

```bash
rm -rf src/gemini
```

- [ ] **Step 3: package.json에서 @google/genai 제거**

```bash
npm uninstall @google/genai
```

- [ ] **Step 4: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: geminiClient import 관련 에러만 발생 (candidate-generator.ts, derivative-generator.ts). 다른 에러는 없어야 함.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "refactor: Gemini 의존성 완전 제거 (config, client, package)"
```

---

## Task 2: LoRA 타입 정의

**Files:**
- Create: `src/characters/types/lora.types.ts`
- Test: `tests/characters/lora-types.test.ts`

- [ ] **Step 1: 타입 파일 작성**

`src/characters/types/lora.types.ts`:

```typescript
/**
 * @module LoRA 학습 파이프라인 타입
 * @description 데이터셋, 학습 작업, 체크포인트, 테스트 이미지 인터페이스.
 *
 * LoraDataset -> LoraDatasetImage[] -> LoraTrainingJob -> LoraCheckpoint[] -> LoraTestImage[]
 *
 * @author AI Video Factory
 */

// ─── 데이터셋 ─────────────────────────────────────────────

export type DatasetStatus = 'preparing' | 'captioning' | 'ready' | 'training' | 'completed';

export interface LoraDataset {
  readonly datasetId: string;
  readonly charId: string;
  readonly name: string;
  readonly triggerWord: string;
  readonly status: DatasetStatus;
  readonly imageCount: number;
  readonly createdAt: Date;
}

export interface LoraDatasetImage {
  readonly datasetImageId: string;
  readonly datasetId: string;
  readonly sourceType: 'candidate' | 'derivative';
  readonly sourceId: string;
  readonly imagePath: string;
  readonly poseTag: string;
  readonly captionAuto: string | null;
  readonly captionEdited: string | null;
  readonly approved: boolean;
  readonly createdAt: Date;
}

// ─── 학습 작업 ────────────────────────────────────────────

export type TrainingStatus = 'queued' | 'training' | 'completed' | 'failed';

export interface LoraTrainingConfig {
  readonly networkDim: number;
  readonly networkAlpha: number;
  readonly learningRate: number;
  readonly lrScheduler: string;
  readonly maxTrainSteps: number;
  readonly trainBatchSize: number;
  readonly gradientAccumulation: number;
  readonly mixedPrecision: string;
  readonly optimizer: string;
  readonly saveEveryNSteps: number;
  readonly seed: number;
}

export const DEFAULT_TRAINING_CONFIG: LoraTrainingConfig = {
  networkDim: 16,
  networkAlpha: 16,
  learningRate: 5e-5,
  lrScheduler: 'cosine',
  maxTrainSteps: 1500,
  trainBatchSize: 1,
  gradientAccumulation: 2,
  mixedPrecision: 'bf16',
  optimizer: 'AdamW8bit',
  saveEveryNSteps: 200,
  seed: 42,
};

export interface LoraTrainingJob {
  readonly jobId: string;
  readonly datasetId: string;
  readonly charId: string;
  readonly status: TrainingStatus;
  readonly config: LoraTrainingConfig;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly errorMessage: string | null;
}

// ─── 체크포인트 ───────────────────────────────────────────

export interface LoraCheckpoint {
  readonly checkpointId: string;
  readonly jobId: string;
  readonly stepNumber: number;
  readonly fileName: string;
  readonly isSelected: boolean;
  readonly createdAt: Date;
}

// ─── 테스트 이미지 ────────────────────────────────────────

export interface LoraTestImage {
  readonly testImageId: string;
  readonly checkpointId: string;
  readonly promptText: string;
  readonly seed: number;
  readonly loraStrength: number;
  readonly imagePath: string;
  readonly createdAt: Date;
}

// ─── API 요청/응답 ────────────────────────────────────────

export interface CreateDatasetRequest {
  readonly charId: string;
  readonly name: string;
  readonly triggerWord: string;
  readonly imageIds: string[];
}

export interface StartTrainingRequest {
  readonly charId: string;
  readonly datasetId: string;
  readonly config?: Partial<LoraTrainingConfig>;
}

export interface TestCheckpointRequest {
  readonly charId: string;
  readonly checkpointId: string;
  readonly loraStrength?: number;
}

export interface SelectCheckpointRequest {
  readonly charId: string;
  readonly checkpointId: string;
}

/** 고정 테스트 프롬프트 5종 */
export const TEST_PROMPTS: readonly string[] = [
  'standing in the rain, holding umbrella, city street, night',
  'wearing formal suit, office background, serious expression',
  'beach setting, summer outfit, bright daylight, smiling',
  'reading a book, library, warm lighting, seated',
  'action pose, running, outdoor park, dynamic angle',
];
```

- [ ] **Step 2: 타입 import 테스트**

`tests/characters/lora-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_TRAINING_CONFIG, TEST_PROMPTS } from '../../src/characters/types/lora.types';
import type { LoraDataset, LoraTrainingJob } from '../../src/characters/types/lora.types';

describe('LoRA types', () => {
  it('DEFAULT_TRAINING_CONFIG has expected defaults', () => {
    expect(DEFAULT_TRAINING_CONFIG.networkDim).toBe(16);
    expect(DEFAULT_TRAINING_CONFIG.learningRate).toBe(5e-5);
    expect(DEFAULT_TRAINING_CONFIG.maxTrainSteps).toBe(1500);
    expect(DEFAULT_TRAINING_CONFIG.optimizer).toBe('AdamW8bit');
  });

  it('TEST_PROMPTS has 5 entries', () => {
    expect(TEST_PROMPTS).toHaveLength(5);
  });

  it('types are structurally valid', () => {
    const dataset: LoraDataset = {
      datasetId: 'ds-001', charId: 'ch-001', name: 'test',
      triggerWord: 'sks_test', status: 'preparing',
      imageCount: 0, createdAt: new Date(),
    };
    expect(dataset.status).toBe('preparing');
  });
});
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run tests/characters/lora-types.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 커밋**

```bash
git add src/characters/types/lora.types.ts tests/characters/lora-types.test.ts
git commit -m "feat: LoRA 파이프라인 타입 정의 (데이터셋, 학습, 체크포인트, 테스트)"
```

---

## Task 3: Oracle DB LoRA 쿼리

**Files:**
- Create: `src/db/queries/lora-queries.ts`

기존 `candidate-queries.ts` 패턴을 따른다: SQL 상수 + Row 타입 + 쿼리 함수.

- [ ] **Step 1: lora-queries.ts 작성 (Part 1 - SQL 상수 + Row 타입)**

`src/db/queries/lora-queries.ts`:

```typescript
/**
 * @module LoRA 학습 쿼리
 * @description lora_datasets, lora_dataset_images, lora_training_jobs,
 *              lora_checkpoints, lora_test_images 테이블 CRUD.
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL: lora_datasets ─────────────────────────────────

export const INSERT_DATASET = `
  INSERT INTO lora_datasets (dataset_id, char_id, name, trigger_word, status, image_count)
  VALUES (:datasetId, :charId, :name, :triggerWord, :status, :imageCount)
`;

export const GET_DATASET = `
  SELECT dataset_id, char_id, name, trigger_word, status, image_count, created_at
    FROM lora_datasets WHERE dataset_id = :datasetId
`;

export const GET_DATASET_BY_CHAR = `
  SELECT dataset_id, char_id, name, trigger_word, status, image_count, created_at
    FROM lora_datasets WHERE char_id = :charId ORDER BY created_at DESC
`;

export const UPDATE_DATASET_STATUS = `
  UPDATE lora_datasets SET status = :status WHERE dataset_id = :datasetId
`;

export const UPDATE_DATASET_IMAGE_COUNT = `
  UPDATE lora_datasets SET image_count = :imageCount WHERE dataset_id = :datasetId
`;

// ─── SQL: lora_dataset_images ───────────────────────────

export const INSERT_DATASET_IMAGE = `
  INSERT INTO lora_dataset_images
    (dataset_image_id, dataset_id, source_type, source_id, image_path, pose_tag, approved)
  VALUES (:datasetImageId, :datasetId, :sourceType, :sourceId, :imagePath, :poseTag, :approved)
`;

export const LIST_DATASET_IMAGES = `
  SELECT dataset_image_id, dataset_id, source_type, source_id,
         image_path, pose_tag, caption_auto, caption_edited, approved, created_at
    FROM lora_dataset_images WHERE dataset_id = :datasetId ORDER BY created_at
`;

export const UPDATE_CAPTION_AUTO = `
  UPDATE lora_dataset_images SET caption_auto = :captionAuto
  WHERE dataset_image_id = :datasetImageId
`;

export const UPDATE_CAPTION_EDITED = `
  UPDATE lora_dataset_images SET caption_edited = :captionEdited
  WHERE dataset_image_id = :datasetImageId
`;

// ─── SQL: lora_training_jobs ────────────────────────────

export const INSERT_TRAINING_JOB = `
  INSERT INTO lora_training_jobs
    (job_id, dataset_id, char_id, status, config, total_steps, started_at)
  VALUES (:jobId, :datasetId, :charId, :status, :config, :totalSteps, SYSTIMESTAMP)
`;

export const GET_TRAINING_JOB = `
  SELECT job_id, dataset_id, char_id, status, config,
         current_step, total_steps, started_at, completed_at, error_message
    FROM lora_training_jobs WHERE job_id = :jobId
`;

export const UPDATE_TRAINING_PROGRESS = `
  UPDATE lora_training_jobs SET current_step = :currentStep WHERE job_id = :jobId
`;

export const UPDATE_TRAINING_STATUS = `
  UPDATE lora_training_jobs
    SET status = :status, completed_at = CASE WHEN :status IN ('completed','failed') THEN SYSTIMESTAMP ELSE completed_at END,
        error_message = :errorMessage
  WHERE job_id = :jobId
`;

// ─── SQL: lora_checkpoints ──────────────────────────────

export const INSERT_CHECKPOINT = `
  INSERT INTO lora_checkpoints (checkpoint_id, job_id, step_number, file_name)
  VALUES (:checkpointId, :jobId, :stepNumber, :fileName)
`;

export const LIST_CHECKPOINTS = `
  SELECT checkpoint_id, job_id, step_number, file_name, is_selected, created_at
    FROM lora_checkpoints WHERE job_id = :jobId ORDER BY step_number
`;

export const SELECT_CHECKPOINT = `
  UPDATE lora_checkpoints SET is_selected = CASE WHEN checkpoint_id = :checkpointId THEN 1 ELSE 0 END
  WHERE job_id = :jobId
`;

// ─── SQL: lora_test_images ──────────────────────────────

export const INSERT_TEST_IMAGE = `
  INSERT INTO lora_test_images
    (test_image_id, checkpoint_id, prompt_text, seed, lora_strength, image_path)
  VALUES (:testImageId, :checkpointId, :promptText, :seed, :loraStrength, :imagePath)
`;

export const LIST_TEST_IMAGES = `
  SELECT test_image_id, checkpoint_id, prompt_text, seed, lora_strength,
         image_path, created_at
    FROM lora_test_images WHERE checkpoint_id = :checkpointId ORDER BY created_at
`;

// ─── Row 타입 ───────────────────────────────────────────

export interface DatasetRow {
  DATASET_ID: string;
  CHAR_ID: string;
  NAME: string;
  TRIGGER_WORD: string;
  STATUS: string;
  IMAGE_COUNT: number;
  CREATED_AT: Date;
}

export interface DatasetImageRow {
  DATASET_IMAGE_ID: string;
  DATASET_ID: string;
  SOURCE_TYPE: string;
  SOURCE_ID: string;
  IMAGE_PATH: string;
  POSE_TAG: string;
  CAPTION_AUTO: string | null;
  CAPTION_EDITED: string | null;
  APPROVED: number;
  CREATED_AT: Date;
}

export interface TrainingJobRow {
  JOB_ID: string;
  DATASET_ID: string;
  CHAR_ID: string;
  STATUS: string;
  CONFIG: string;
  CURRENT_STEP: number;
  TOTAL_STEPS: number;
  STARTED_AT: Date | null;
  COMPLETED_AT: Date | null;
  ERROR_MESSAGE: string | null;
}

export interface CheckpointRow {
  CHECKPOINT_ID: string;
  JOB_ID: string;
  STEP_NUMBER: number;
  FILE_NAME: string;
  IS_SELECTED: number;
  CREATED_AT: Date;
}

export interface TestImageRow {
  TEST_IMAGE_ID: string;
  CHECKPOINT_ID: string;
  PROMPT_TEXT: string;
  SEED: number;
  LORA_STRENGTH: number;
  IMAGE_PATH: string;
  CREATED_AT: Date;
}
```

NOTE: 이 파일이 300줄에 근접하므로 쿼리 함수는 별도 파일로 분리할지 구현 시 판단. SQL 상수와 Row 타입만으로도 서비스에서 직접 `conn.execute(INSERT_DATASET, binds)` 패턴으로 사용 가능.

- [ ] **Step 2: 커밋**

```bash
git add src/db/queries/lora-queries.ts
git commit -m "feat: LoRA 테이블 SQL 쿼리 + Row 타입 정의"
```

---

## Task 4: Kontext 앵커/편집 워크플로우

**Files:**
- Create: `src/comfyui/workflows/kontext-workflows.ts`
- Test: `tests/comfyui/kontext-workflows.test.ts`

기존 `workflow-builder.ts`의 패턴을 따르되, 별도 파일로 분리한다 (300줄 제한).

- [ ] **Step 1: 테스트 작성**

`tests/comfyui/kontext-workflows.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildKontextAnchorWorkflow,
  buildKontextEditWorkflow,
} from '../../src/comfyui/workflows/kontext-workflows';

describe('buildKontextAnchorWorkflow', () => {
  it('returns workflow with correct node types', () => {
    const wf = buildKontextAnchorWorkflow({
      prompt: 'test character, front view',
      seed: 12345,
    });
    const nodes = Object.values(wf);
    const classTypes = nodes.map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('KSampler');
    expect(classTypes).toContain('SaveImage');
  });

  it('applies custom seed', () => {
    const wf = buildKontextAnchorWorkflow({ prompt: 'test', seed: 99999 });
    const sampler = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'KSampler'
    ) as { inputs: { seed: number } };
    expect(sampler.inputs.seed).toBe(99999);
  });

  it('uses default resolution 1024x1024', () => {
    const wf = buildKontextAnchorWorkflow({ prompt: 'test', seed: 1 });
    const latent = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'EmptyLatentImage'
    ) as { inputs: { width: number; height: number } };
    expect(latent.inputs.width).toBe(1024);
    expect(latent.inputs.height).toBe(1024);
  });
});

describe('buildKontextEditWorkflow', () => {
  it('returns workflow with LoadImage node', () => {
    const wf = buildKontextEditWorkflow({
      anchorImageName: 'anchor_001.png',
      editPrompt: 'same character, sitting in cafe',
      seed: 12345,
    });
    const loadImage = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'LoadImage'
    ) as { inputs: { image: string } };
    expect(loadImage).toBeDefined();
    expect(loadImage.inputs.image).toBe('anchor_001.png');
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npx vitest run tests/comfyui/kontext-workflows.test.ts
```

Expected: FAIL - module not found

- [ ] **Step 3: 워크플로우 구현**

`src/comfyui/workflows/kontext-workflows.ts`:

```typescript
/**
 * @module FLUX.1 Kontext 워크플로우
 * @description Kontext [dev] 모델 기반 앵커 생성(t2i) + 이미지 편집(i2i) 워크플로우.
 *
 * 앵커: LoadModel -> CLIPEncode -> KSampler -> VAEDecode -> SaveImage
 * 편집: LoadImage -> KontextSampler(image+prompt) -> VAEDecode -> SaveImage
 *
 * @dependencies comfyui.types
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';

// ─── Kontext 모델 설정 ──────────────────────────────────

const KONTEXT_DEFAULTS = {
  model: 'flux1-kontext-dev.safetensors',
  vae: 'ae.safetensors',
  clipL: 'clip_l.safetensors',
  t5xxl: 't5xxl_fp8_e4m3fn.safetensors',
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 2.5,
  sampler: 'euler',
  scheduler: 'normal',
  filenamePrefix: 'kontext_anchor',
} as const;

// ─── 옵션 인터페이스 ────────────────────────────────────

export interface KontextAnchorOptions {
  prompt: string;
  seed: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
}

export interface KontextEditOptions {
  anchorImageName: string;
  editPrompt: string;
  seed: number;
  guidanceScale?: number;
  steps?: number;
  filenamePrefix?: string;
}

// ─── 앵커 생성 (text-to-image) ──────────────────────────

export function buildKontextAnchorWorkflow(opts: KontextAnchorOptions): ComfyUIWorkflow {
  const width = opts.width ?? KONTEXT_DEFAULTS.width;
  const height = opts.height ?? KONTEXT_DEFAULTS.height;
  const steps = opts.steps ?? KONTEXT_DEFAULTS.steps;
  const cfg = opts.cfg ?? KONTEXT_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? KONTEXT_DEFAULTS.filenamePrefix;

  logger.debug('Kontext 앵커 워크플로우 생성', {
    seed: opts.seed, width, height, steps, cfg,
  });

  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: KONTEXT_DEFAULTS.model, weight_dtype: 'default' },
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
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.prompt, clip: ['2', 0] },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: opts.seed,
        steps,
        cfg,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise: 1.0,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['3', 0] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: prefix },
    },
  };
}

// ─── 이미지 편집 (Kontext i2i) ──────────────────────────

export function buildKontextEditWorkflow(opts: KontextEditOptions): ComfyUIWorkflow {
  const steps = opts.steps ?? KONTEXT_DEFAULTS.steps;
  const guidance = opts.guidanceScale ?? KONTEXT_DEFAULTS.cfg;
  const prefix = opts.filenamePrefix ?? 'kontext_edit';

  logger.debug('Kontext 편집 워크플로우 생성', {
    seed: opts.seed, anchor: opts.anchorImageName, guidance,
  });

  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: KONTEXT_DEFAULTS.model, weight_dtype: 'default' },
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
    '4': {
      class_type: 'LoadImage',
      inputs: { image: opts.anchorImageName },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.editPrompt, clip: ['2', 0] },
    },
    '6': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['4', 0], vae: ['3', 0] },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['5', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed: opts.seed,
        steps,
        cfg: guidance,
        sampler_name: KONTEXT_DEFAULTS.sampler,
        scheduler: KONTEXT_DEFAULTS.scheduler,
        denoise: 0.75,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['3', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: prefix },
    },
  };
}
```

NOTE: 정확한 노드 이름(UNETLoader vs UnetLoaderGGUF, KontextSampler 등)은 ComfyUI 서버의 실제 커스텀 노드에 맞춰 구현 시 조정. 위 구현은 표준 ComfyUI 노드 기반 뼈대.

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run tests/comfyui/kontext-workflows.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/comfyui/workflows/kontext-workflows.ts tests/comfyui/kontext-workflows.test.ts
git commit -m "feat: Kontext 앵커/편집 ComfyUI 워크플로우 빌더"
```

---

## Task 5: LoRA 학습/추론 + 캡셔닝 워크플로우

**Files:**
- Create: `src/comfyui/workflows/lora-workflows.ts`
- Create: `src/comfyui/workflows/caption-workflows.ts`
- Test: `tests/comfyui/lora-workflows.test.ts`

- [ ] **Step 1: 테스트 작성**

`tests/comfyui/lora-workflows.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildLoraInferenceWorkflow } from '../../src/comfyui/workflows/lora-workflows';
import { buildCaptionWorkflow } from '../../src/comfyui/workflows/caption-workflows';

describe('buildLoraInferenceWorkflow', () => {
  it('includes LoadLoRA node with correct file', () => {
    const wf = buildLoraInferenceWorkflow({
      loraFileName: 'my_char_v1.safetensors',
      prompt: 'sks_char, beach scene',
      seed: 123,
      loraStrength: 0.7,
    });
    const loraNode = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'LoraLoader'
    ) as { inputs: { lora_name: string; strength_model: number } };
    expect(loraNode).toBeDefined();
    expect(loraNode.inputs.lora_name).toBe('my_char_v1.safetensors');
    expect(loraNode.inputs.strength_model).toBe(0.7);
  });
});

describe('buildCaptionWorkflow', () => {
  it('includes Florence2 node', () => {
    const wf = buildCaptionWorkflow({ imageName: 'test.png' });
    const nodes = Object.values(wf);
    const classTypes = nodes.map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('Florence2Run');
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
npx vitest run tests/comfyui/lora-workflows.test.ts
```

Expected: FAIL

- [ ] **Step 3: caption-workflows.ts 작성**

`src/comfyui/workflows/caption-workflows.ts`:

```typescript
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
```

- [ ] **Step 4: lora-workflows.ts 작성**

`src/comfyui/workflows/lora-workflows.ts`:

```typescript
/**
 * @module LoRA 학습/추론 워크플로우
 * @description FluxTrainer 기반 LoRA 학습 + LoRA 적용 추론 테스트 워크플로우.
 *
 * 학습: FluxTrainSetup -> FluxTrainExecute -> SaveLoRA
 * 추론: UNETLoader -> LoraLoader -> KSampler -> VAEDecode -> SaveImage
 *
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';
import type { LoraTrainingConfig } from '../../characters/types/lora.types';

// ─── 학습 워크플로우 ────────────────────────────────────

const KONTEXT_MODEL = 'flux1-kontext-dev.safetensors';

export interface LoraTrainWorkflowOptions {
  config: LoraTrainingConfig;
  datasetPath: string;
  outputDir: string;
  outputName: string;
}

export function buildLoraTrainWorkflow(opts: LoraTrainWorkflowOptions): ComfyUIWorkflow {
  logger.debug('LoRA 학습 워크플로우 생성', {
    dataset: opts.datasetPath, steps: opts.config.maxTrainSteps,
  });

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
        network_dim: opts.config.networkDim,
        network_alpha: opts.config.networkAlpha,
        learning_rate: opts.config.learningRate,
        lr_scheduler: opts.config.lrScheduler,
        max_train_steps: opts.config.maxTrainSteps,
        train_batch_size: opts.config.trainBatchSize,
        gradient_accumulation_steps: opts.config.gradientAccumulation,
        mixed_precision: opts.config.mixedPrecision,
        optimizer_type: opts.config.optimizer,
        save_every_n_steps: opts.config.saveEveryNSteps,
        seed: opts.config.seed,
        output_dir: opts.outputDir,
        output_name: opts.outputName,
      },
    },
    '4': {
      class_type: 'FluxTrainExecute',
      inputs: { training: ['3', 0] },
    },
  };
}

// ─── 추론 테스트 워크플로우 ──────────────────────────────

export interface LoraInferenceOptions {
  loraFileName: string;
  prompt: string;
  seed: number;
  loraStrength?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
}

export function buildLoraInferenceWorkflow(opts: LoraInferenceOptions): ComfyUIWorkflow {
  const strength = opts.loraStrength ?? 0.7;
  const steps = opts.steps ?? 8;
  const cfg = opts.cfg ?? 2.5;
  const prefix = opts.filenamePrefix ?? 'lora_test';

  logger.debug('LoRA 추론 워크플로우 생성', {
    lora: opts.loraFileName, strength, seed: opts.seed,
  });

  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: KONTEXT_MODEL, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0],
        clip: ['3', 0],
        lora_name: opts.loraFileName,
        strength_model: strength,
        strength_clip: strength,
      },
    },
    '3': {
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: 'clip_l.safetensors',
        clip_name2: 't5xxl_fp8_e4m3fn.safetensors',
        type: 'flux',
      },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: opts.prompt, clip: ['2', 1] },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    '6': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'ae.safetensors' },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['4', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: opts.seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['6', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: prefix },
    },
  };
}
```

NOTE: FluxTrainModelSelect, TrainDatasetAdd, FluxTrainSetup, FluxTrainExecute 노드 이름은 ComfyUI-FluxTrainer (kijai) 기준 추정. 실제 설치 후 `GET /object_info` API로 정확한 노드명 확인 필요.

- [ ] **Step 5: 테스트 실행**

```bash
npx vitest run tests/comfyui/lora-workflows.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 6: 커밋**

```bash
git add src/comfyui/workflows/ tests/comfyui/lora-workflows.test.ts
git commit -m "feat: LoRA 학습/추론 + Florence-2 캡셔닝 워크플로우 빌더"
```

---

## Task 6: candidate-generator Kontext 전환

**Files:**
- Modify: `src/characters/services/candidate-generator.ts`

Gemini 호출을 ComfyUI Kontext 워크플로우로 교체한다.

- [ ] **Step 1: import 교체**

`src/characters/services/candidate-generator.ts`에서:

```typescript
// 삭제:
import { geminiClient } from '../../gemini/client';

// 추가:
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextAnchorWorkflow } from '../../comfyui/workflows/kontext-workflows';
```

- [ ] **Step 2: processOneCandidate 함수의 Gemini 호출을 ComfyUI로 교체**

`processOneCandidate` 함수 내 이미지 생성 부분 (157~166행):

```typescript
// 삭제:
  const result = await geminiClient.generateImage({
    prompt: promptItem.prompt,
    aspectRatio: '3:4',
    imageSize: '1K',
  });
  const filename = `${job.charId}_${promptItem.seed}.png`;
  const imagePath = path.join(outDir, filename);
  const imageBuffer = result.imageBuffer;
  await writeFileBuffer(imagePath, imageBuffer);

// 교체:
  const workflow = buildKontextAnchorWorkflow({
    prompt: promptItem.prompt,
    seed: promptItem.seed,
    filenamePrefix: `${job.charId}_${promptItem.seed}`,
  });
  await comfyuiClient.connect();
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 120_000);
  if (images.length === 0) {
    throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');
  }
  // ComfyUI output에서 이미지 다운로드
  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${job.charId}_${promptItem.seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
```

config import 추가:
```typescript
import { config } from '../../config';
```

- [ ] **Step 3: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | grep candidate-generator
```

Expected: 에러 없음 (derivative-generator의 gemini 에러만 남아야 함)

- [ ] **Step 4: 커밋**

```bash
git add src/characters/services/candidate-generator.ts
git commit -m "refactor: candidate-generator Gemini -> ComfyUI Kontext 전환"
```

---

## Task 7: derivative-generator Kontext 전환

**Files:**
- Modify: `src/characters/services/derivative-generator.ts`

Gemini 호출을 ComfyUI Kontext 편집 워크플로우로 교체한다.

- [ ] **Step 1: import 교체**

```typescript
// 삭제:
import { geminiClient } from '../../gemini/client';

// 추가:
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
```

- [ ] **Step 2: generateOneImage 함수의 Gemini 호출을 ComfyUI로 교체**

`generateOneImage` 함수 내 이미지 생성 부분 (232~244행):

```typescript
// 삭제:
  const result = await geminiClient.generateImage({
    prompt: fullPrompt,
    referenceImages: [job.anchorPath],
    aspectRatio: '3:4',
    imageSize: '1K',
  });
  const filename = `${job.charId}_${preset.label}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  const imageBuffer = result.imageBuffer;
  await writeFileBuffer(imagePath, imageBuffer);

// 교체:
  // 앵커 이미지를 ComfyUI에 업로드 (최초 1회만)
  await comfyuiClient.connect();
  const anchorName = await comfyuiClient.uploadImage(job.anchorPath);

  const editPrompt = `same character, ${preset.promptSuffix}`;
  const workflow = buildKontextEditWorkflow({
    anchorImageName: anchorName,
    editPrompt,
    seed,
    filenamePrefix: `${job.charId}_${preset.label}_${seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 120_000);
  if (images.length === 0) {
    throw new Error('ComfyUI 편집 결과 없음');
  }
  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${job.charId}_${preset.label}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
```

NOTE: 앵커 업로드가 프리셋마다 반복되지 않도록, `processDerivativeLoop`에서 한 번만 업로드하고 이름을 캐싱하는 최적화는 구현 시 적용.

- [ ] **Step 3: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: gemini 관련 에러 전부 해소

- [ ] **Step 4: 커밋**

```bash
git add src/characters/services/derivative-generator.ts
git commit -m "refactor: derivative-generator Gemini -> ComfyUI Kontext 편집 전환"
```

---

## Task 8: lora-dataset 서비스

**Files:**
- Create: `src/characters/services/lora-dataset.ts`

데이터셋 생성, Florence-2 캡셔닝 오케스트레이션, 캡션 수정을 담당한다.

- [ ] **Step 1: lora-dataset.ts 작성**

`src/characters/services/lora-dataset.ts`:

```typescript
/**
 * @module LoRA 데이터셋 서비스
 * @description 승인된 파생 이미지로 학습 데이터셋을 구성하고 Florence-2 캡셔닝을 실행한다.
 *
 * 승인된 이미지 -> 데이터셋 구성 -> ComfyUI 캡셔닝 -> 캡션 저장
 *
 * @dependencies comfyui, lora-queries, caption-workflows
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import { comfyuiClient } from '../../comfyui/client';
import { buildCaptionWorkflow } from '../../comfyui/workflows/caption-workflows';
import { getConnection } from '../../db/connection';
import {
  INSERT_DATASET, GET_DATASET, GET_DATASET_BY_CHAR,
  UPDATE_DATASET_STATUS, UPDATE_DATASET_IMAGE_COUNT,
  INSERT_DATASET_IMAGE, LIST_DATASET_IMAGES,
  UPDATE_CAPTION_AUTO, UPDATE_CAPTION_EDITED,
} from '../../db/queries/lora-queries';
import type { DatasetRow, DatasetImageRow } from '../../db/queries/lora-queries';
import { logger } from '../../common/logger';
import oracledb from 'oracledb';

// ─── SSE 이벤트 ────────────────────────────────────────

export const datasetEvents = new EventEmitter();
datasetEvents.setMaxListeners(50);

// ─── 데이터셋 생성 ─────────────────────────────────────

export async function createDataset(
  charId: string, name: string, triggerWord: string,
  imageIds: string[], sourceType: 'candidate' | 'derivative',
): Promise<string> {
  const datasetId = randomUUID();
  const conn = await getConnection();
  try {
    await conn.execute(INSERT_DATASET, {
      datasetId, charId, name, triggerWord,
      status: 'preparing', imageCount: imageIds.length,
    }, { autoCommit: false });

    for (const sourceId of imageIds) {
      await conn.execute(INSERT_DATASET_IMAGE, {
        datasetImageId: randomUUID(), datasetId,
        sourceType, sourceId,
        imagePath: '', poseTag: '', approved: 1,
      }, { autoCommit: false });
    }

    await conn.commit();
    logger.info('데이터셋 생성 완료', { datasetId, charId, count: imageIds.length });
    return datasetId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.close();
  }
}

// ─── 데이터셋 조회 ─────────────────────────────────────

export async function getDataset(datasetId: string): Promise<DatasetRow | null> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<DatasetRow>(
      GET_DATASET, { datasetId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows?.[0] ?? null;
  } finally {
    await conn.close();
  }
}

export async function getDatasetByChar(charId: string): Promise<DatasetRow[]> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<DatasetRow>(
      GET_DATASET_BY_CHAR, { charId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  } finally {
    await conn.close();
  }
}

export async function listDatasetImages(datasetId: string): Promise<DatasetImageRow[]> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<DatasetImageRow>(
      LIST_DATASET_IMAGES, { datasetId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  } finally {
    await conn.close();
  }
}

// ─── 캡셔닝 실행 ───────────────────────────────────────

export async function startCaptioning(
  datasetId: string, triggerWord: string,
): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_DATASET_STATUS, { datasetId, status: 'captioning' }, { autoCommit: true });
  } finally {
    await conn.close();
  }

  const images = await listDatasetImages(datasetId);
  await comfyuiClient.connect();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    datasetEvents.emit(`caption:${datasetId}`, {
      datasetId, current: i + 1, total: images.length,
      status: 'captioning', imagePath: img.IMAGE_PATH,
    });

    try {
      const uploadedName = await comfyuiClient.uploadImage(img.IMAGE_PATH);
      const workflow = buildCaptionWorkflow({ imageName: uploadedName });
      const promptId = await comfyuiClient.submitWorkflow(workflow);
      const results = await comfyuiClient.waitForResult(promptId, 60_000);

      // Florence-2 결과에서 캡션 텍스트 추출 (워크플로우 출력 구조에 따라 조정)
      const caption = extractCaptionFromResult(results);
      const finalCaption = `${triggerWord}, ${caption}`;

      const updateConn = await getConnection();
      try {
        await updateConn.execute(UPDATE_CAPTION_AUTO, {
          datasetImageId: img.DATASET_IMAGE_ID, captionAuto: finalCaption,
        }, { autoCommit: true });
      } finally {
        await updateConn.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('캡셔닝 실패', { imageId: img.DATASET_IMAGE_ID, error: msg });
    }
  }

  const doneConn = await getConnection();
  try {
    await doneConn.execute(UPDATE_DATASET_STATUS, { datasetId, status: 'ready' }, { autoCommit: true });
  } finally {
    await doneConn.close();
  }

  datasetEvents.emit(`caption:${datasetId}`, {
    datasetId, current: images.length, total: images.length, status: 'ready',
  });
}

function extractCaptionFromResult(results: unknown[]): string {
  // Florence-2 노드는 텍스트를 반환. 구현 시 실제 출력 형태에 맞춰 파싱.
  // 기본: 빈 문자열 반환 (구현 시 조정)
  return String(results[0] ?? '');
}

// ─── 캡션 수정 ──────────────────────────────────────────

export async function updateCaption(datasetImageId: string, caption: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_CAPTION_EDITED, {
      datasetImageId, captionEdited: caption,
    }, { autoCommit: true });
  } finally {
    await conn.close();
  }
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | grep lora-dataset
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/characters/services/lora-dataset.ts
git commit -m "feat: LoRA 데이터셋 서비스 (생성, 조회, Florence-2 캡셔닝)"
```

---

## Task 9: lora-training 서비스

**Files:**
- Create: `src/characters/services/lora-training.ts`

학습 실행, 진행률 모니터링, 체크포인트 관리, 추론 테스트를 담당한다.

- [ ] **Step 1: lora-training.ts 작성**

`src/characters/services/lora-training.ts`:

```typescript
/**
 * @module LoRA 학습 서비스
 * @description ComfyUI FluxTrainer로 LoRA 학습을 실행하고 모니터링한다.
 *
 * 데이터 스테이징 -> 학습 실행 -> 체크포인트 관리 -> 추론 테스트
 *
 * @dependencies comfyui, lora-queries, lora-workflows
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import { comfyuiClient } from '../../comfyui/client';
import { buildLoraTrainWorkflow, buildLoraInferenceWorkflow } from '../../comfyui/workflows/lora-workflows';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import {
  INSERT_TRAINING_JOB, GET_TRAINING_JOB, UPDATE_TRAINING_STATUS,
  UPDATE_TRAINING_PROGRESS, INSERT_CHECKPOINT, LIST_CHECKPOINTS,
  SELECT_CHECKPOINT, INSERT_TEST_IMAGE, LIST_TEST_IMAGES,
} from '../../db/queries/lora-queries';
import type { TrainingJobRow, CheckpointRow, TestImageRow } from '../../db/queries/lora-queries';
import { listDatasetImages } from './lora-dataset';
import { DEFAULT_TRAINING_CONFIG, TEST_PROMPTS } from '../types/lora.types';
import type { LoraTrainingConfig } from '../types/lora.types';
import { logger } from '../../common/logger';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import oracledb from 'oracledb';
import path from 'path';

// ─── SSE 이벤트 ────────────────────────────────────────

export const trainingEvents = new EventEmitter();
trainingEvents.setMaxListeners(50);

// ─── 학습 시작 ─────────────────────────────────────────

export async function startTraining(
  charId: string, datasetId: string,
  userConfig?: Partial<LoraTrainingConfig>,
): Promise<string> {
  const jobId = randomUUID();
  const mergedConfig: LoraTrainingConfig = { ...DEFAULT_TRAINING_CONFIG, ...userConfig };

  const conn = await getConnection();
  try {
    await conn.execute(INSERT_TRAINING_JOB, {
      jobId, datasetId, charId, status: 'queued',
      config: JSON.stringify(mergedConfig),
      totalSteps: mergedConfig.maxTrainSteps,
    }, { autoCommit: true });
  } finally {
    await conn.close();
  }

  logger.info('LoRA 학습 작업 생성', { jobId, charId, datasetId });

  // 비동기 학습 실행
  executeTraining(jobId, charId, datasetId, mergedConfig).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('LoRA 학습 실패', { jobId, error: msg });
    updateJobStatus(jobId, 'failed', msg);
  });

  return jobId;
}

async function executeTraining(
  jobId: string, charId: string, datasetId: string,
  trainingConfig: LoraTrainingConfig,
): Promise<void> {
  // 1. 데이터셋 이미지를 ComfyUI에 스테이징
  const images = await listDatasetImages(datasetId);
  await comfyuiClient.connect();

  for (const img of images) {
    await comfyuiClient.uploadImage(img.IMAGE_PATH);
  }

  // 2. 학습 워크플로우 실행
  await updateJobStatus(jobId, 'training');
  const outputDir = `models/loras/${charId}`;
  const outputName = `${charId}_r${trainingConfig.networkDim}_s${trainingConfig.maxTrainSteps}`;

  const workflow = buildLoraTrainWorkflow({
    config: trainingConfig,
    datasetPath: `/tmp/training/${datasetId}`,
    outputDir,
    outputName,
  });

  const promptId = await comfyuiClient.submitWorkflow(workflow);

  // 3. 진행률 모니터링
  comfyuiClient.onProgress((update) => {
    if (update.type === 'progress' && update.data.prompt_id === promptId) {
      const step = update.data.value ?? 0;
      trainingEvents.emit(`train:${jobId}`, { jobId, step, total: trainingConfig.maxTrainSteps, status: 'training' });
      updateTrainingProgress(jobId, step);
    }
  });

  await comfyuiClient.waitForResult(promptId, 3_600_000); // 1시간 타임아웃

  // 4. 완료 처리
  await updateJobStatus(jobId, 'completed');
  trainingEvents.emit(`train:${jobId}`, { jobId, step: trainingConfig.maxTrainSteps, total: trainingConfig.maxTrainSteps, status: 'completed' });
  logger.info('LoRA 학습 완료', { jobId, charId });
}

// ─── 조회 ──────────────────────────────────────────────

export async function getTrainingJob(jobId: string): Promise<TrainingJobRow | null> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<TrainingJobRow>(
      GET_TRAINING_JOB, { jobId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows?.[0] ?? null;
  } finally {
    await conn.close();
  }
}

export async function listCheckpoints(jobId: string): Promise<CheckpointRow[]> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<CheckpointRow>(
      LIST_CHECKPOINTS, { jobId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  } finally {
    await conn.close();
  }
}

// ─── 추론 테스트 ────────────────────────────────────────

export async function testCheckpoint(
  charId: string, checkpointId: string,
  triggerWord: string, loraStrength: number = 0.7,
): Promise<void> {
  const conn = await getConnection();
  let fileName: string;
  try {
    const result = await conn.execute<CheckpointRow>(
      'SELECT file_name FROM lora_checkpoints WHERE checkpoint_id = :checkpointId',
      { checkpointId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    fileName = result.rows?.[0]?.FILE_NAME ?? '';
    if (!fileName) throw new Error('체크포인트 파일을 찾을 수 없습니다');
  } finally {
    await conn.close();
  }

  await comfyuiClient.connect();
  const outDir = path.resolve(`exports/lora_tests/${charId}`);
  await ensureDir(outDir);

  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const prompt = `${triggerWord}, ${TEST_PROMPTS[i]}`;
    const seed = 42 + i;

    trainingEvents.emit(`test:${checkpointId}`, {
      checkpointId, current: i + 1, total: TEST_PROMPTS.length, status: 'testing',
    });

    const workflow = buildLoraInferenceWorkflow({
      loraFileName: fileName, prompt, seed, loraStrength,
      filenamePrefix: `test_${checkpointId}_${i}`,
    });

    const promptId = await comfyuiClient.submitWorkflow(workflow);
    const images = await comfyuiClient.waitForResult(promptId, 120_000);

    if (images.length > 0) {
      const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
      const response = await fetch(imageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      const imagePath = path.join(outDir, `test_${checkpointId}_${i}.png`);
      await writeFileBuffer(imagePath, buffer);

      const saveConn = await getConnection();
      try {
        await saveConn.execute(INSERT_TEST_IMAGE, {
          testImageId: randomUUID(), checkpointId,
          promptText: prompt, seed, loraStrength, imagePath,
        }, { autoCommit: true });
      } finally {
        await saveConn.close();
      }
    }
  }

  trainingEvents.emit(`test:${checkpointId}`, {
    checkpointId, current: TEST_PROMPTS.length, total: TEST_PROMPTS.length, status: 'done',
  });
}

// ─── 체크포인트 선택 ────────────────────────────────────

export async function selectCheckpoint(
  charId: string, jobId: string, checkpointId: string,
): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(SELECT_CHECKPOINT, { checkpointId, jobId }, { autoCommit: true });
    // character.loraPath 업데이트
    const cpResult = await conn.execute<CheckpointRow>(
      'SELECT file_name FROM lora_checkpoints WHERE checkpoint_id = :checkpointId',
      { checkpointId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const fileName = cpResult.rows?.[0]?.FILE_NAME;
    if (fileName) {
      await conn.execute(
        'UPDATE characters SET lora_path = :loraPath WHERE char_id = :charId',
        { loraPath: fileName, charId }, { autoCommit: true },
      );
    }
    logger.info('LoRA 체크포인트 선택', { charId, checkpointId, fileName });
  } finally {
    await conn.close();
  }
}

// ─── 유틸 ──────────────────────────────────────────────

async function updateJobStatus(jobId: string, status: string, errorMessage?: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_TRAINING_STATUS, {
      jobId, status, errorMessage: errorMessage ?? null,
    }, { autoCommit: true });
  } finally {
    await conn.close();
  }
}

async function updateTrainingProgress(jobId: string, step: number): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_TRAINING_PROGRESS, { jobId, currentStep: step }, { autoCommit: true });
  } finally {
    await conn.close();
  }
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | grep lora-training
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/characters/services/lora-training.ts
git commit -m "feat: LoRA 학습 서비스 (학습 실행, 모니터링, 추론 테스트, 체크포인트 선택)"
```

---

## Task 10: LoRA REST 라우트

**Files:**
- Create: `src/characters/routes/lora-routes.ts`
- Modify: `src/web/routes/web-routes.ts` (LoRA UI 라우트 추가)

기존 `character-routes.ts`의 패턴 (asyncHandler, getConnection, SSE)을 따른다.

- [ ] **Step 1: lora-routes.ts 작성**

`src/characters/routes/lora-routes.ts`:

```typescript
/**
 * @module LoRA 학습 파이프라인 API
 * @description 데이터셋 관리, 캡셔닝, 학습, 체크포인트 평가 REST 엔드포인트.
 *
 * @dependencies lora-dataset, lora-training
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  createDataset, getDatasetByChar, listDatasetImages,
  startCaptioning, updateCaption, datasetEvents,
} from '../services/lora-dataset';
import {
  startTraining, getTrainingJob, listCheckpoints,
  testCheckpoint, selectCheckpoint, trainingEvents,
} from '../services/lora-training';
import type {
  CreateDatasetRequest, StartTrainingRequest,
  TestCheckpointRequest, SelectCheckpointRequest,
} from '../types/lora.types';
import { logger } from '../../common/logger';

const router = Router();

// ─── 데이터셋 ──────────────────────────────────────────

router.post('/:charId/lora/dataset', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreateDatasetRequest;
  const charId = String(req.params.charId);
  const datasetId = await createDataset(
    charId, body.name, body.triggerWord, body.imageIds, 'derivative',
  );
  res.json({ success: true, datasetId });
}));

router.get('/:charId/lora/dataset', asyncHandler(async (req: Request, res: Response) => {
  const charId = String(req.params.charId);
  const datasets = await getDatasetByChar(charId);
  res.json({ success: true, data: datasets });
}));

router.get('/:charId/lora/dataset/images', asyncHandler(async (req: Request, res: Response) => {
  const datasetId = String(req.query.datasetId);
  const images = await listDatasetImages(datasetId);
  res.json({ success: true, data: images });
}));

// ─── 캡셔닝 ────────────────────────────────────────────

router.post('/:charId/lora/caption', asyncHandler(async (req: Request, res: Response) => {
  const { datasetId, triggerWord } = req.body as { datasetId: string; triggerWord: string };
  startCaptioning(datasetId, triggerWord).catch((err: unknown) => {
    logger.error('캡셔닝 실패', { error: String(err) });
  });
  res.json({ success: true, message: '캡셔닝 시작' });
}));

router.get('/:charId/lora/caption/stream', (req: Request, res: Response) => {
  const datasetId = String(req.query.datasetId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  datasetEvents.on(`caption:${datasetId}`, onProgress);
  req.on('close', () => { datasetEvents.off(`caption:${datasetId}`, onProgress); });
});

router.put('/:charId/lora/caption/:imageId', asyncHandler(async (req: Request, res: Response) => {
  const imageId = String(req.params.imageId);
  const { caption } = req.body as { caption: string };
  await updateCaption(imageId, caption);
  res.json({ success: true });
}));

// ─── 학습 ──────────────────────────────────────────────

router.post('/:charId/lora/train', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as StartTrainingRequest;
  const charId = String(req.params.charId);
  const jobId = await startTraining(charId, body.datasetId, body.config);
  res.json({ success: true, jobId });
}));

router.get('/:charId/lora/train/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = await getTrainingJob(jobId);
  if (!job) {
    res.status(404).json({ success: false, error: '학습 작업을 찾을 수 없습니다' });
    return;
  }
  res.json({ success: true, data: job });
}));

router.get('/:charId/lora/train/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  trainingEvents.on(`train:${jobId}`, onProgress);
  req.on('close', () => { trainingEvents.off(`train:${jobId}`, onProgress); });
});

// ─── 평가 ──────────────────────────────────────────────

router.get('/:charId/lora/checkpoints', asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.query.jobId);
  const checkpoints = await listCheckpoints(jobId);
  res.json({ success: true, data: checkpoints });
}));

router.post('/:charId/lora/test', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as TestCheckpointRequest;
  const charId = String(req.params.charId);
  testCheckpoint(charId, body.checkpointId, 'sks_character', body.loraStrength).catch((err: unknown) => {
    logger.error('테스트 실패', { error: String(err) });
  });
  res.json({ success: true, message: '테스트 이미지 생성 시작' });
}));

router.get('/:charId/lora/test/stream', (req: Request, res: Response) => {
  const checkpointId = String(req.query.checkpointId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  trainingEvents.on(`test:${checkpointId}`, onProgress);
  req.on('close', () => { trainingEvents.off(`test:${checkpointId}`, onProgress); });
});

router.post('/:charId/lora/select', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SelectCheckpointRequest;
  const charId = String(req.params.charId);
  const jobId = String(req.query.jobId);
  await selectCheckpoint(charId, jobId, body.checkpointId);
  res.json({ success: true });
}));

export default router;
```

- [ ] **Step 2: server.ts에 라우트 등록**

`src/server.ts` (또는 라우트 등록 위치)에 추가:

```typescript
import loraRoutes from './characters/routes/lora-routes';
app.use('/api/characters', loraRoutes);
```

- [ ] **Step 3: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/characters/routes/lora-routes.ts
git commit -m "feat: LoRA REST API 라우트 (데이터셋, 캡셔닝, 학습, 평가)"
```

---

## Task 11: 웹 UI - 데이터셋 페이지

**Files:**
- Create: `src/web/views/characters/lora-dataset.ejs`
- Modify: `src/web/views/layouts/sidebar.ejs` (LoRA 메뉴 추가)
- Modify: `src/web/routes/web-routes.ts` (페이지 라우트 추가)

기존 `derivatives.ejs` 패턴을 따른다: Tailwind + Alpine.js + SSE.

- [ ] **Step 1: lora-dataset.ejs 작성**

`src/web/views/characters/lora-dataset.ejs`: 승인된 파생 이미지 그리드 + 체크박스 선별 + trigger_word 입력 + 캡셔닝 버튼 + 캡션 인라인 편집. 상세 구현은 기존 candidates.ejs/derivatives.ejs의 레이아웃/스타일 패턴을 따른다.

핵심 구조:
- Alpine.js `x-data`로 상태 관리 (selectedImages, triggerWord, captions)
- Fetch API로 POST /api/characters/:charId/lora/dataset
- EventSource로 GET /api/characters/:charId/lora/caption/stream
- 캡션 편집 시 PUT /api/characters/:charId/lora/caption/:imageId

- [ ] **Step 2: sidebar에 메뉴 추가**

```html
<a href="/characters/lora-dataset" class="sidebar-link">LoRA 데이터셋</a>
<a href="/characters/lora-training" class="sidebar-link">LoRA 학습</a>
```

- [ ] **Step 3: web-routes.ts에 페이지 라우트 추가**

```typescript
router.get('/characters/lora-dataset', (_req, res) => {
  res.render('characters/lora-dataset', { title: 'LoRA 데이터셋' });
});
router.get('/characters/lora-training', (_req, res) => {
  res.render('characters/lora-training', { title: 'LoRA 학습' });
});
```

- [ ] **Step 4: 커밋**

```bash
git add src/web/
git commit -m "feat: LoRA 데이터셋 웹 UI 페이지 + 사이드바 메뉴"
```

---

## Task 12: 웹 UI - 학습 모니터 페이지

**Files:**
- Create: `src/web/views/characters/lora-training.ejs`
- Create: `src/web/public/js/lora.js`

- [ ] **Step 1: lora-training.ejs 작성**

핵심 구조:
- 학습 파라미터 폼 (steps, lr, dim, alpha) — `DEFAULT_TRAINING_CONFIG` 값을 기본값으로
- "학습 시작" 버튼 → POST /api/characters/:charId/lora/train
- EventSource로 진행률 수신 → 프로그레스 바 + step/loss 표시
- 체크포인트 목록 그리드
- 체크포인트별 "테스트" 버튼 → POST /api/characters/:charId/lora/test
- 테스트 이미지 5종 비교 그리드
- "이 체크포인트 선택" 버튼 → POST /api/characters/:charId/lora/select

- [ ] **Step 2: lora.js 작성**

데이터셋/학습 UI 공용 JavaScript:
- SSE 연결 관리
- 캡션 인라인 편집 fetch
- 학습 파라미터 폼 제출
- 체크포인트 테스트/선택 fetch

- [ ] **Step 3: 커밋**

```bash
git add src/web/views/characters/lora-training.ejs src/web/public/js/lora.js
git commit -m "feat: LoRA 학습 모니터 + 체크포인트 평가 웹 UI"
```

---

## Task 13: ARCHITECTURE.md + 통합 테스트

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: ARCHITECTURE.md 업데이트**

LoRA 파이프라인 모듈 추가, 디렉토리 트리 업데이트, ComfyUI 커스텀 노드 목록 추가.

- [ ] **Step 2: 전체 빌드 + 린트 확인**

```bash
npx tsc --noEmit && npx eslint src/ --max-warnings 0
```

Expected: 에러/경고 없음

- [ ] **Step 3: 전체 테스트 실행**

```bash
npx vitest run
```

Expected: 모든 테스트 PASS

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "docs: ARCHITECTURE.md LoRA 파이프라인 반영 + 통합 점검"
```

---

## 의존성 그래프

```
Task 1 (Gemini 제거)
  |
  v
Task 2 (타입) -----> Task 3 (DB 쿼리)
  |                    |
  v                    v
Task 4 (Kontext WF) --> Task 5 (LoRA/Caption WF)
  |         |                |
  v         v                v
Task 6    Task 7     Task 8 (dataset 서비스)
(cand.)   (deriv.)          |
                            v
                     Task 9 (training 서비스)
                            |
                            v
                     Task 10 (REST 라우트)
                            |
                     +------+------+
                     v             v
              Task 11          Task 12
              (dataset UI)     (training UI)
                     |             |
                     +------+------+
                            v
                     Task 13 (문서 + 통합)
```
