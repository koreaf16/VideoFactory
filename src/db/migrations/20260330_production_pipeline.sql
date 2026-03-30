-- ============================================================
-- Production Pipeline — Oracle 26ai
-- ============================================================

-- 1. production_runs: 전체 제작 진행 상태 추적
CREATE TABLE production_runs (
  run_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  script_id       NUMBER REFERENCES master_scripts(script_id),
  protagonist_id  VARCHAR2(50) REFERENCES characters(char_id),
  current_stage   VARCHAR2(32) NOT NULL
                  CHECK (current_stage IN (
                    'protagonist_pending','protagonist_visual','script_pending',
                    'episode_generating','assets_creating','snapshots_generating',
                    'completed','failed','paused'
                  )),
  current_ep_num  NUMBER DEFAULT 0,
  config_json     CLOB,
  error_message   VARCHAR2(4000),
  auto_advance    NUMBER(1) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 2. pipeline_steps: 단계별 세부 추적
CREATE TABLE pipeline_steps (
  step_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        NUMBER REFERENCES production_runs(run_id),
  ep_id         NUMBER,
  step_type     VARCHAR2(64) NOT NULL,
  step_status   VARCHAR2(32) DEFAULT 'pending'
                CHECK (step_status IN ('pending','running','completed','failed','skipped')),
  input_json    CLOB,
  output_json   CLOB,
  error_message VARCHAR2(4000),
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP,
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_pipeline_steps_run ON pipeline_steps(run_id);
CREATE INDEX idx_pipeline_steps_ep  ON pipeline_steps(ep_id);

-- 3. 기존 테이블 변경
ALTER TABLE characters ADD (
  is_protagonist  NUMBER(1) DEFAULT 0,
  recurring       NUMBER(1) DEFAULT 1
);

ALTER TABLE locations ADD (
  recurring       NUMBER(1) DEFAULT 1
);
