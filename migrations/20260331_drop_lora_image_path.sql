-- Drop image_path columns from LoRA tables
ALTER TABLE lora_dataset_images DROP COLUMN image_path;
ALTER TABLE lora_test_images DROP COLUMN image_path;

COMMENT ON TABLE lora_dataset_images IS 'LoRA 학습용 데이터셋 이미지 (이미지는 image_blob에 저장)';
COMMENT ON TABLE lora_test_images IS 'LoRA 체크포인트 테스트 생성 결과 (이미지는 image_blob에 저장)';
