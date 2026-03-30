-- ============================================================
-- LoRA BBox & BLOB Policy Enforcement — Oracle 26ai
-- ============================================================

-- 1. char_candidates: 얼굴 좌표 추가
ALTER TABLE char_candidates ADD (
  face_bbox         JSON
);

-- 2. char_ref_images: 얼굴 좌표 추가
ALTER TABLE char_ref_images ADD (
  face_bbox         JSON
);

-- 3. lora_dataset_images: BLOB 정책 + 얼굴 데이터 추가
ALTER TABLE lora_dataset_images ADD (
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  face_crop_blob    BLOB,
  face_bbox         JSON,
  face_embedding    VECTOR(512, FLOAT32)
);

-- 4. lora_test_images: BLOB 정책 적용
ALTER TABLE lora_test_images ADD (
  image_blob        BLOB,
  thumbnail_blob    BLOB
);

-- 5. lora_checkpoints: 선택된 모델 경로 저장을 위한 컬럼 (이미 존재하면 건너뜀)
-- lora_path는 characters 테이블에 이미 있음.

COMMENT ON COLUMN char_candidates.face_bbox IS '얼굴 좌표 (top, left, width, height)';
COMMENT ON COLUMN lora_dataset_images.face_crop_blob IS '얼굴만 정교하게 크롭된 학습용 이미지 BLOB';
