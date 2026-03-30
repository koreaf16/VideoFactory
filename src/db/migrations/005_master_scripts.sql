-- ============================================================
-- Master Scripts + Episodes FK — Oracle 26ai
-- ============================================================

-- 1. master_scripts: 마스터 대본 테이블
CREATE TABLE master_scripts (
  script_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         VARCHAR2(200)  NOT NULL,
  genre         VARCHAR2(100),
  synopsis      CLOB,
  world_setting CLOB,
  status        VARCHAR2(20) DEFAULT 'active'
                CHECK (status IN ('draft','active','completed','archived')),
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 2. episodes.script_id FK
ALTER TABLE episodes ADD (
  script_id NUMBER REFERENCES master_scripts(script_id)
);

-- 3. 인덱스
CREATE INDEX idx_episodes_script_id ON episodes(script_id);
