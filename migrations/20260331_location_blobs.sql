-- Add BLOB columns to location_candidates
ALTER TABLE location_candidates ADD (
  image_blob        BLOB,
  thumbnail_blob    BLOB
);

COMMENT ON COLUMN location_candidates.image_blob IS '장소 배경 후보 이미지 원본 BLOB';
COMMENT ON COLUMN location_candidates.thumbnail_blob IS '장소 배경 후보 썸네일 (256px)';
