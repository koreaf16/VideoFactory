-- Drop image_path columns as images are now stored as BLOBs
-- and served via /api/images/:table/:id

ALTER TABLE char_candidates DROP COLUMN image_path;
ALTER TABLE char_ref_images DROP COLUMN image_path;
ALTER TABLE location_candidates DROP COLUMN image_path;
ALTER TABLE location_ref_images DROP COLUMN image_path;
ALTER TABLE item_ref_images DROP COLUMN image_path;

-- Also scenes table has paths that could be redundant if we use BLOBs,
-- but the user specifically mentioned character images and "rest of images".
-- For now, we only drop the ones we've migrated.

COMMENT ON TABLE char_candidates IS '캐릭터 후보 이미지 (이미지는 image_blob에 저장)';
COMMENT ON TABLE char_ref_images IS '캐릭터 파생 레퍼런스 이미지 (이미지는 image_blob에 저장)';
COMMENT ON TABLE location_candidates IS '장소 후보 이미지 (이미지는 image_blob에 저장)';
COMMENT ON TABLE location_ref_images IS '장소 레퍼런스 이미지 (이미지는 image_blob에 저장)';
