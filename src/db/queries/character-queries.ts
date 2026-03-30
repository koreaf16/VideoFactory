/**
 * @module 캐릭터 쿼리
 * @description characters 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *              서비스 파일에서 인라인 SQL 없이 이 모듈을 import 해서 사용한다.
 *
 * ┌──────────────┐     ┌──────────────────┐     ┌──────────┐
 * │ Service      │ ──→ │ character-queries │ ──→ │ Oracle   │
 * │ (비즈니스)    │     │ (SQL 정의)        │     │ 26ai DB  │
 * └──────────────┘     └──────────────────┘     └──────────┘
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const FIND_BY_ID = `
  SELECT char_id, name, name_en, role, char_type,
         profile, appearance, prompt_base, voice_config, mood,
         lora_path, anchor_blob, anchor_thumbnail, created_at
    FROM characters
   WHERE char_id = :charId
`;

export const LIST_ALL = `
  SELECT char_id, name, name_en, role, char_type,
         prompt_base, lora_path, created_at,
         CASE WHEN anchor_thumbnail IS NOT NULL THEN 1 ELSE 0 END AS HAS_ANCHOR
    FROM characters
   ORDER BY CASE WHEN char_type = 'protagonist' THEN 0 ELSE 1 END,
            created_at ASC
`;

export const INSERT = `
  INSERT INTO characters
    (char_id, name, name_en, role, char_type,
     profile, appearance, prompt_base, voice_config, mood, lora_path)
  VALUES
    (:charId, :name, :nameEn, :role, :charType,
     :profile, :appearance, :promptBase, :voiceConfig, :mood, :loraPath)
`;

export const UPDATE_ANCHOR = `
  UPDATE characters
     SET anchor_blob      = :anchorBlob,
         anchor_thumbnail = :thumbnailBlob,
         face_embedding   = :embedding
   WHERE char_id = :charId
`;

export const UPDATE_STATUS = `
  UPDATE characters
     SET char_type = :charType
   WHERE char_id = :charId
`;

export const DELETE_CHARACTER = `DELETE FROM characters WHERE char_id = :charId`;
export const DELETE_CANDIDATES_BY_CHAR = `DELETE FROM char_candidates WHERE char_id = :charId`;
export const DELETE_REF_IMAGES_BY_CHAR = `DELETE FROM char_ref_images WHERE char_id = :charId`;

// LoRA 관련 삭제 (외래 키 순서)
export const DELETE_LORA_TEST_IMAGES_BY_CHAR = `
  DELETE FROM lora_test_images WHERE checkpoint_id IN (
    SELECT checkpoint_id FROM lora_checkpoints WHERE job_id IN (
      SELECT job_id FROM lora_training_jobs WHERE char_id = :charId
    )
  )
`;
export const DELETE_LORA_CHECKPOINTS_BY_CHAR = `
  DELETE FROM lora_checkpoints WHERE job_id IN (
    SELECT job_id FROM lora_training_jobs WHERE char_id = :charId
  )
`;
export const DELETE_LORA_TRAINING_JOBS_BY_CHAR = `DELETE FROM lora_training_jobs WHERE char_id = :charId`;
export const DELETE_LORA_DATASET_IMAGES_BY_CHAR = `
  DELETE FROM lora_dataset_images WHERE dataset_id IN (
    SELECT dataset_id FROM lora_datasets WHERE char_id = :charId
  )
`;
export const DELETE_LORA_DATASETS_BY_CHAR = `DELETE FROM lora_datasets WHERE char_id = :charId`;

// ─── 쿼리 함수 ──────────────────────────────────────────

interface CharacterRow {
  CHAR_ID: string;
  NAME: string;
  NAME_EN: string | null;
  ROLE: string | null;
  CHAR_TYPE: string | null;
  PROMPT_BASE: string | null;
  LORA_PATH: string | null;
  ANCHOR_BLOB: Buffer | null;
  ANCHOR_THUMBNAIL: Buffer | null;
  HAS_ANCHOR: number;
  CREATED_AT: Date;
}

interface CharacterInsertData {
  charId: string;
  name: string;
  nameEn: string | null;
  role: string | null;
  charType: string | null;
  profile: string | null;
  appearance: string | null;
  promptBase: string | null;
  voiceConfig: string | null;
  mood: string | null;
  loraPath: string | null;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

export async function findCharacterById(
  conn: oracledb.Connection,
  charId: string,
): Promise<CharacterRow | undefined> {
  const result = await conn.execute<CharacterRow>(
    FIND_BY_ID,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('캐릭터 조회', { charId, found: (result.rows?.length ?? 0) > 0 });
  return result.rows?.[0];
}

export async function listCharacters(conn: oracledb.Connection): Promise<CharacterRow[]> {
  const result = await conn.execute<CharacterRow>(
    LIST_ALL,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('캐릭터 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function insertCharacter(
  conn: oracledb.Connection,
  data: CharacterInsertData,
): Promise<void> {
  await conn.execute(INSERT, data as unknown as Record<string, unknown>, { autoCommit: true });
  logger.info('캐릭터 생성', { charId: data.charId, name: data.name });
}

export async function updateCharacterStatus(
  conn: oracledb.Connection,
  charId: string,
  charType: string,
): Promise<void> {
  await conn.execute(UPDATE_STATUS, { charType, charId }, { autoCommit: true });
  logger.info('캐릭터 상태 업데이트', { charId, charType });
}

export async function deleteCharacter(
  conn: oracledb.Connection,
  charId: string,
): Promise<void> {
  // 외래 키 제약 순서: 자식부터 부모 순으로 삭제
  // 1. LoRA 테스트 이미지 (lora_checkpoints 참조)
  await conn.execute(DELETE_LORA_TEST_IMAGES_BY_CHAR, { charId }, { autoCommit: false });
  // 2. LoRA 체크포인트 (lora_training_jobs 참조)
  await conn.execute(DELETE_LORA_CHECKPOINTS_BY_CHAR, { charId }, { autoCommit: false });
  // 3. LoRA 학습 작업 (char_id 참조)
  await conn.execute(DELETE_LORA_TRAINING_JOBS_BY_CHAR, { charId }, { autoCommit: false });
  // 4. LoRA 데이터셋 이미지 (lora_datasets 참조)
  await conn.execute(DELETE_LORA_DATASET_IMAGES_BY_CHAR, { charId }, { autoCommit: false });
  // 5. LoRA 데이터셋 (char_id 참조)
  await conn.execute(DELETE_LORA_DATASETS_BY_CHAR, { charId }, { autoCommit: false });
  // 6. 캐릭터 파생 이미지 (char_id 참조)
  await conn.execute(DELETE_REF_IMAGES_BY_CHAR, { charId }, { autoCommit: false });
  // 7. 캐릭터 후보 (char_id 참조)
  await conn.execute(DELETE_CANDIDATES_BY_CHAR, { charId }, { autoCommit: false });
  // 8. 캐릭터 (부모 테이블)
  await conn.execute(DELETE_CHARACTER, { charId }, { autoCommit: true });
  logger.info('캐릭터 삭제', { charId });
}

export async function updateCharacterAnchor(
  conn: oracledb.Connection,
  charId: string,
  anchorBlob: Buffer,
  thumbnailBlob: Buffer,
  embedding: number[],
): Promise<void> {
  await conn.execute(
    UPDATE_ANCHOR,
    {
      charId,
      anchorBlob,
      thumbnailBlob,
      embedding: JSON.stringify(embedding),
    },
    { autoCommit: true },
  );
  logger.info('캐릭터 앵커 업데이트', { charId });
}

// ─── 파생 이미지(char_ref_images) 쿼리 재내보내기 ──────
export * from './ref-image-queries';
