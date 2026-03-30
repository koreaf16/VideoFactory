-- ============================================================
-- LoRA Pipeline Tables DDL — Oracle 26ai
-- ============================================================

-- 1. lora_datasets: 데이터셋 마스터 정보
CREATE TABLE lora_datasets (
  dataset_id        VARCHAR2(50)    PRIMARY KEY,
  char_id           VARCHAR2(50)    REFERENCES characters(char_id),
  name              VARCHAR2(100)   NOT NULL,
  trigger_word      VARCHAR2(50)    NOT NULL,
  status            VARCHAR2(20)    DEFAULT 'draft',
  image_count       NUMBER          DEFAULT 0,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- 2. lora_dataset_images: 데이터셋에 포함된 이미지 정보
CREATE TABLE lora_dataset_images (
  dataset_image_id  VARCHAR2(50)    PRIMARY KEY,
  dataset_id        VARCHAR2(50)    REFERENCES lora_datasets(dataset_id),
  source_type       VARCHAR2(20),   -- 'derivative', 'candidate', 'upload'
  source_id         VARCHAR2(50),   -- ref_id or candidate_id
  image_path        VARCHAR2(500),
  pose_tag          VARCHAR2(50),
  caption_auto      VARCHAR2(1000),
  caption_edited    VARCHAR2(1000),
  approved          NUMBER(1)       DEFAULT 1,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- 3. lora_training_jobs: 학습 작업 정보
CREATE TABLE lora_training_jobs (
  job_id            VARCHAR2(50)    PRIMARY KEY,
  dataset_id        VARCHAR2(50)    REFERENCES lora_datasets(dataset_id),
  char_id           VARCHAR2(50)    REFERENCES characters(char_id),
  status            VARCHAR2(20)    DEFAULT 'pending', -- pending, running, completed, failed
  config            JSON,
  current_step      NUMBER          DEFAULT 0,
  total_steps       NUMBER          DEFAULT 0,
  started_at        TIMESTAMP,
  completed_at      TIMESTAMP,
  error_message     VARCHAR2(1000),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- 4. lora_checkpoints: 학습 도중 생성된 가중치 파일
CREATE TABLE lora_checkpoints (
  checkpoint_id     VARCHAR2(50)    PRIMARY KEY,
  job_id            VARCHAR2(50)    REFERENCES lora_training_jobs(job_id),
  step_number       NUMBER          NOT NULL,
  file_name         VARCHAR2(200)   NOT NULL,
  is_selected       NUMBER(1)       DEFAULT 0,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- 5. lora_test_images: 체크포인트별 추론 테스트 결과
CREATE TABLE lora_test_images (
  test_image_id     VARCHAR2(50)    PRIMARY KEY,
  checkpoint_id     VARCHAR2(50)    REFERENCES lora_checkpoints(checkpoint_id),
  prompt_text       VARCHAR2(1000),
  seed              NUMBER,
  lora_strength     NUMBER(4,2),
  image_path        VARCHAR2(500),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);
