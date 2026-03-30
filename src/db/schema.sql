-- ============================================================
-- VideoFactory Phase 1 DDL — Oracle 26ai
-- ============================================================
--
-- ★ BLOB 저장 정책 (이중 저장)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 모든 이미지는 파일 경로 + BLOB 두 가지로 저장한다.
--
--   image_path     : 파일시스템 경로 (ComfyUI / FFmpeg 작업용)
--   image_blob     : Oracle BLOB (백업 / 검색 / 이식용)
--   thumbnail_blob : 256px 리사이즈 JPEG (웹 UI 그리드 표시용)
--
-- 이미지 저장 시 saveImageWithBlob() 헬퍼,
-- BLOB 복원 시 restoreImageFromBlob() 헬퍼를 반드시 사용할 것.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- -----------------------------------------------------------
-- 1. characters — 캐릭터 기본 정보
-- -----------------------------------------------------------
CREATE TABLE characters (
  char_id           VARCHAR2(50)    PRIMARY KEY,
  name              VARCHAR2(100)   NOT NULL,
  name_en           VARCHAR2(100),
  role              VARCHAR2(50),
  char_type         VARCHAR2(30),
  profile           JSON,
  appearance        JSON,
  voice_config      JSON,
  mood              JSON,
  face_embedding    VECTOR(512, FLOAT32),
  anchor_blob       BLOB,
  anchor_thumbnail  BLOB,
  prompt_base       VARCHAR2(2000),
  lora_path         VARCHAR2(500),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 2. char_candidates — 캐릭터 후보 이미지
-- -----------------------------------------------------------
CREATE TABLE char_candidates (
  candidate_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  char_id           VARCHAR2(50)    REFERENCES characters(char_id),
  job_id            VARCHAR2(100),
  image_path        VARCHAR2(500)   NOT NULL,
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  prompt_text       VARCHAR2(2000),
  seed              NUMBER,
  quality_score     NUMBER(4,3),
  grade             VARCHAR2(5),
  liked             NUMBER(1)       DEFAULT 0,
  is_anchor         NUMBER(1)       DEFAULT 0,
  image_embedding   VECTOR(512, FLOAT32),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 3. char_ref_images — 캐릭터 레퍼런스 이미지
-- -----------------------------------------------------------
CREATE TABLE char_ref_images (
  ref_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  char_id           VARCHAR2(50)    REFERENCES characters(char_id),
  image_path        VARCHAR2(500)   NOT NULL,
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  pose_tag          VARCHAR2(50),
  image_embedding   VECTOR(512, FLOAT32),
  quality_score     NUMBER(4,3),
  approved          NUMBER(1)       DEFAULT 1,
  is_custom         NUMBER(1)       DEFAULT 0,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 4. locations — 장소 정보
-- -----------------------------------------------------------
CREATE TABLE locations (
  location_id       VARCHAR2(50)    PRIMARY KEY,
  name              VARCHAR2(100)   NOT NULL,
  name_en           VARCHAR2(100),
  region_id         VARCHAR2(50),
  location_type     VARCHAR2(30),
  prompt_base       VARCHAR2(2000),
  prompt_variants   JSON,
  description       VARCHAR2(1000),
  first_ep          NUMBER,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 5. location_ref_images — 장소 레퍼런스 이미지
-- -----------------------------------------------------------
CREATE TABLE location_ref_images (
  ref_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id       VARCHAR2(50)    REFERENCES locations(location_id),
  image_path        VARCHAR2(500),
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  time_of_day       VARCHAR2(20),
  weather           VARCHAR2(30),
  angle             VARCHAR2(30),
  image_embedding   VECTOR(512, FLOAT32),
  is_anchor         NUMBER(1)       DEFAULT 0,
  quality_score     NUMBER(4,3),
  approved          NUMBER(1)       DEFAULT 1,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 5-b. location_candidates — 장소 배경 후보 이미지
-- -----------------------------------------------------------
CREATE TABLE location_candidates (
  candidate_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id       VARCHAR2(50)    REFERENCES locations(location_id),
  job_id            VARCHAR2(100),
  image_path        VARCHAR2(500)   NOT NULL,
  prompt_text       VARCHAR2(2000),
  seed              NUMBER,
  quality_score     NUMBER(4,3),
  liked             NUMBER(1)       DEFAULT 0,
  is_anchor         NUMBER(1)       DEFAULT 0,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 6. item_ref_images — 아이템 레퍼런스 이미지
-- -----------------------------------------------------------
CREATE TABLE item_ref_images (
  ref_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id           VARCHAR2(50),
  image_path        VARCHAR2(500),
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  state             VARCHAR2(30)    DEFAULT 'normal',
  angle             VARCHAR2(30),
  image_embedding   VECTOR(512, FLOAT32),
  is_anchor         NUMBER(1)       DEFAULT 0,
  quality_score     NUMBER(4,3),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- 7. episodes — 에피소드
-- -----------------------------------------------------------
CREATE TABLE episodes (
  ep_id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ep_number         NUMBER          NOT NULL,
  title             VARCHAR2(200),
  synopsis          VARCHAR2(2000),
  ep_type           VARCHAR2(30)    DEFAULT 'story',
  status            VARCHAR2(30)    DEFAULT 'draft',
  script_json       CLOB,
  world_state       JSON,
  decision_reasoning VARCHAR2(2000),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP,
  approved_at       TIMESTAMP,
  published_at      TIMESTAMP
);

-- -----------------------------------------------------------
-- 8. scenes — 씬 (에피소드 하위)
-- -----------------------------------------------------------
CREATE TABLE scenes (
  scene_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ep_id             NUMBER          REFERENCES episodes(ep_id),
  scene_order       NUMBER          NOT NULL,
  description       VARCHAR2(1000),
  location_id       VARCHAR2(50)    REFERENCES locations(location_id),
  time_of_day       VARCHAR2(20),
  camera_type       VARCHAR2(30),
  emotion           VARCHAR2(30),
  duration_sec      NUMBER,
  script            JSON,
  prompt_en         VARCHAR2(2000),
  motion_prompt     VARCHAR2(1000),
  status            VARCHAR2(30)    DEFAULT 'draft',
  keyframe_path     VARCHAR2(500),
  keyframe_blob     BLOB,
  video_path        VARCHAR2(500),
  upscaled_path     VARCHAR2(500),
  tts_path          VARCHAR2(500),
  quality_score     NUMBER(4,3),
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);

-- -----------------------------------------------------------
-- scene_characters — 씬별 출연 캐릭터
-- -----------------------------------------------------------
CREATE TABLE scene_characters (
  scene_id    NUMBER       REFERENCES scenes(scene_id) ON DELETE CASCADE,
  char_id     VARCHAR2(50) REFERENCES characters(char_id),
  PRIMARY KEY (scene_id, char_id)
);

-- -----------------------------------------------------------
-- 9. prompt_templates — 프롬프트 템플릿
-- -----------------------------------------------------------
CREATE TABLE prompt_templates (
  template_id       VARCHAR2(50)    PRIMARY KEY,
  layer             VARCHAR2(30),
  category          VARCHAR2(50),
  prompt_text       VARCHAR2(4000),
  description       VARCHAR2(500),
  active            NUMBER(1)       DEFAULT 1
);

-- -----------------------------------------------------------
-- 10. running_gags — 러닝 개그 관리
-- -----------------------------------------------------------
CREATE TABLE running_gags (
  gag_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  description       VARCHAR2(1000),
  trigger_char      VARCHAR2(50),
  last_used_ep      NUMBER,
  usage_count       NUMBER          DEFAULT 0,
  active            NUMBER(1)       DEFAULT 1
);
