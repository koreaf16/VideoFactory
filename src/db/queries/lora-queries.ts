/**
 * @module LoRA 데이터셋/학습 쿼리
 * @description LoRA 파이프라인 5개 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *              서비스 파일에서 인라인 SQL 없이 이 모듈을 import 해서 사용한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ Service      │ --> │ lora-queries │ --> │ Oracle   │
 * │ (비즈니스)    │     │ (SQL 정의)    │     │ 26ai DB  │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 *   lora_datasets ──< lora_dataset_images
 *        │
 *        v
 *   lora_training_jobs ──< lora_checkpoints ──< lora_test_images
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

// ─── lora_datasets SQL ─────────────────────────────────

export const INSERT_DATASET = `
  INSERT INTO lora_datasets
    (dataset_id, char_id, name, trigger_word, status, image_count)
  VALUES
    (:datasetId, :charId, :name, :triggerWord, :status, :imageCount)
`;

export const GET_DATASET = `
  SELECT dataset_id, char_id, name, trigger_word,
         status, image_count, created_at
    FROM lora_datasets
   WHERE dataset_id = :datasetId
`;

export const GET_DATASET_BY_CHAR = `
  SELECT dataset_id, char_id, name, trigger_word,
         status, image_count, created_at
    FROM lora_datasets
   WHERE char_id = :charId
   ORDER BY created_at DESC
`;

export const UPDATE_DATASET_STATUS = `
  UPDATE lora_datasets
     SET status = :status
   WHERE dataset_id = :datasetId
`;

export const UPDATE_DATASET_IMAGE_COUNT = `
  UPDATE lora_datasets
     SET image_count = :imageCount
   WHERE dataset_id = :datasetId
`;

// ─── lora_dataset_images SQL ───────────────────────────

export const INSERT_DATASET_IMAGE = `
  INSERT INTO lora_dataset_images
    (dataset_image_id, dataset_id, source_type, source_id,
     image_path, pose_tag, approved)
  VALUES
    (:datasetImageId, :datasetId, :sourceType, :sourceId,
     :imagePath, :poseTag, :approved)
`;

export const LIST_DATASET_IMAGES = `
  SELECT dataset_image_id, dataset_id, source_type, source_id,
         image_path, pose_tag, caption_auto, caption_edited,
         approved, created_at
    FROM lora_dataset_images
   WHERE dataset_id = :datasetId
   ORDER BY created_at
`;

export const UPDATE_CAPTION_AUTO = `
  UPDATE lora_dataset_images
     SET caption_auto = :captionAuto
   WHERE dataset_image_id = :datasetImageId
`;

export const UPDATE_CAPTION_EDITED = `
  UPDATE lora_dataset_images
     SET caption_edited = :captionEdited
   WHERE dataset_image_id = :datasetImageId
`;

// ─── lora_training_jobs SQL ────────────────────────────

export const INSERT_TRAINING_JOB = `
  INSERT INTO lora_training_jobs
    (job_id, dataset_id, char_id, status, config,
     total_steps, started_at)
  VALUES
    (:jobId, :datasetId, :charId, :status, :config,
     :totalSteps, SYSTIMESTAMP)
`;

export const GET_TRAINING_JOB = `
  SELECT job_id, dataset_id, char_id, status, config,
         current_step, total_steps, started_at,
         completed_at, error_message
    FROM lora_training_jobs
   WHERE job_id = :jobId
`;

export const UPDATE_TRAINING_PROGRESS = `
  UPDATE lora_training_jobs
     SET current_step = :currentStep
   WHERE job_id = :jobId
`;

export const UPDATE_TRAINING_STATUS = `
  UPDATE lora_training_jobs
     SET status = :status,
         completed_at = CASE
           WHEN :status IN ('completed', 'failed') THEN SYSTIMESTAMP
           ELSE completed_at
         END,
         error_message = :errorMessage
   WHERE job_id = :jobId
`;

// ─── lora_checkpoints SQL ──────────────────────────────

export const INSERT_CHECKPOINT = `
  INSERT INTO lora_checkpoints
    (checkpoint_id, job_id, step_number, file_name)
  VALUES
    (:checkpointId, :jobId, :stepNumber, :fileName)
`;

export const LIST_CHECKPOINTS = `
  SELECT checkpoint_id, job_id, step_number, file_name,
         is_selected, created_at
    FROM lora_checkpoints
   WHERE job_id = :jobId
   ORDER BY step_number
`;

export const GET_CHECKPOINT = `
  SELECT checkpoint_id, job_id, step_number, file_name,
         is_selected, created_at
    FROM lora_checkpoints
   WHERE checkpoint_id = :checkpointId
`;

export const SELECT_CHECKPOINT = `
  UPDATE lora_checkpoints
     SET is_selected = CASE
           WHEN checkpoint_id = :checkpointId THEN 1
           ELSE 0
         END
   WHERE job_id = :jobId
`;

export const UPDATE_CHARACTER_LORA = `
  UPDATE characters
     SET lora_path = :loraPath
   WHERE char_id = :charId
`;

// ─── lora_test_images SQL ──────────────────────────────

export const INSERT_TEST_IMAGE = `
  INSERT INTO lora_test_images
    (test_image_id, checkpoint_id, prompt_text, seed,
     lora_strength, image_path)
  VALUES
    (:testImageId, :checkpointId, :promptText, :seed,
     :loraStrength, :imagePath)
`;

export const LIST_TEST_IMAGES = `
  SELECT test_image_id, checkpoint_id, prompt_text, seed,
         lora_strength, image_path, created_at
    FROM lora_test_images
   WHERE checkpoint_id = :checkpointId
   ORDER BY created_at
`;

// ─── 행 타입 ───────────────────────────────────────────

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
  POSE_TAG: string | null;
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
  CURRENT_STEP: number | null;
  TOTAL_STEPS: number;
  STARTED_AT: Date;
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
