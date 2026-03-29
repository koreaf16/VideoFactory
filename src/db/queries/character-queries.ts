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
         profile, appearance, voice_config, mood,
         lora_path, created_at
    FROM characters
   WHERE char_id = :charId
`;

export const LIST_ALL = `
  SELECT char_id, name, name_en, role, char_type,
         lora_path, created_at
    FROM characters
   ORDER BY created_at DESC
`;

export const INSERT = `
  INSERT INTO characters
    (char_id, name, name_en, role, char_type,
     profile, appearance, voice_config, mood, lora_path)
  VALUES
    (:charId, :name, :nameEn, :role, :charType,
     :profile, :appearance, :voiceConfig, :mood, :loraPath)
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

// ─── 쿼리 함수 ──────────────────────────────────────────

interface CharacterRow {
  CHAR_ID: string;
  NAME: string;
  NAME_EN: string | null;
  ROLE: string | null;
  CHAR_TYPE: string | null;
  LORA_PATH: string | null;
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
  voiceConfig: string | null;
  mood: string | null;
  loraPath: string | null;
}

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

// ─── 파생 이미지(char_ref_images) 쿼리 ─────────────────

export const LIST_REF_IMAGES_BY_CHAR = `
  SELECT ref_id, char_id, image_path, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE char_id = :charId AND approved = 1
   ORDER BY created_at ASC
`;

export const GET_REF_IMAGE = `
  SELECT ref_id, char_id, image_path, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE ref_id = :refId
`;

export const UPDATE_REF_IMAGE_PATH = `
  UPDATE char_ref_images
     SET image_path = :imagePath
   WHERE ref_id = :refId
`;

export const DELETE_REF_IMAGE = `
  DELETE FROM char_ref_images WHERE ref_id = :refId
`;

export const GET_ANCHOR_PATH = `
  SELECT image_path
    FROM char_candidates
   WHERE char_id = :charId AND is_anchor = 1
   FETCH FIRST 1 ROWS ONLY
`;

export const COUNT_REF_IMAGES_BY_CHAR = `
  SELECT COUNT(*) AS CNT
    FROM char_ref_images
   WHERE char_id = :charId AND approved = 1
`;

export interface RefImageRow {
  REF_ID: number;
  CHAR_ID: string;
  IMAGE_PATH: string;
  POSE_TAG: string | null;
  QUALITY_SCORE: number | null;
  APPROVED: number;
  CREATED_AT: Date;
}

export async function listRefImagesByChar(
  conn: oracledb.Connection,
  charId: string,
): Promise<RefImageRow[]> {
  const result = await conn.execute<RefImageRow>(
    LIST_REF_IMAGES_BY_CHAR,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('파생 이미지 목록 조회', { charId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function getRefImage(
  conn: oracledb.Connection,
  refId: number,
): Promise<RefImageRow | undefined> {
  const result = await conn.execute<RefImageRow>(
    GET_REF_IMAGE,
    { refId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0];
}

export async function getAnchorPath(
  conn: oracledb.Connection,
  charId: string,
): Promise<string | null> {
  const result = await conn.execute<{ IMAGE_PATH: string }>(
    GET_ANCHOR_PATH,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.IMAGE_PATH ?? null;
}

export async function countRefImagesByChar(
  conn: oracledb.Connection,
  charId: string,
): Promise<number> {
  const result = await conn.execute<{ CNT: number }>(
    COUNT_REF_IMAGES_BY_CHAR,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.CNT ?? 0;
}
