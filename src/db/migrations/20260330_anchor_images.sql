-- ============================================================
-- Migration: 20260330 - Unified Anchor Images System
-- ============================================================
-- Purpose: Replace char_candidates and location_candidates
--          with polymorphic anchor_images table.
-- Notes: Idempotent - safe to run multiple times
-- ============================================================

-- 1. Drop old tables (if they exist)
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE char_candidates';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE location_candidates';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 2. Create new anchor_images table
CREATE TABLE anchor_images (
  anchor_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type     VARCHAR2(20) NOT NULL
                  CHECK (entity_type IN ('character', 'location', 'npc')),
  entity_id       VARCHAR2(50) NOT NULL,

  -- Image & metadata
  image_blob      BLOB NOT NULL,
  thumbnail_blob  BLOB,
  image_path      VARCHAR2(500),

  -- Generation info
  job_id          VARCHAR2(100),
  prompt_text     VARCHAR2(2000),
  seed            NUMBER,
  quality_score   NUMBER(3,2),
  grade           VARCHAR2(1),

  -- Face info (for character entities)
  face_bbox       VARCHAR2(200),
  face_embedding  VECTOR(384, FLOAT32),

  -- Timestamps
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP,

  -- Constraints
  UNIQUE (entity_type, entity_id)
);

-- 3. Create indexes
CREATE INDEX idx_anchor_entity ON anchor_images(entity_type, entity_id);
CREATE INDEX idx_anchor_job ON anchor_images(job_id);

-- 4. Modify characters table
-- Step 4a: Drop face_embedding and anchor columns if they exist
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE characters DROP COLUMN face_embedding';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE characters DROP COLUMN anchor_thumbnail';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE characters DROP COLUMN anchor_blob';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- Step 4b: Add new anchor_id column
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE characters ADD anchor_id NUMBER REFERENCES anchor_images(anchor_id)';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 5. Modify locations table
-- Add anchor_id column if it doesn't exist
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE locations ADD anchor_id NUMBER REFERENCES anchor_images(anchor_id)';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

COMMIT;
