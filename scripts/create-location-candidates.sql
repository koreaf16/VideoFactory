-- location_candidates — 장소 배경 후보 이미지
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
