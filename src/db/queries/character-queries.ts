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
  charId: string
): Promise<CharacterRow | undefined> {
  const result = await conn.execute<CharacterRow>(FIND_BY_ID, { charId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  logger.debug('캐릭터 조회', { charId, found: (result.rows?.length ?? 0) > 0 });
  return result.rows?.[0];
}

export async function listCharacters(
  conn: oracledb.Connection
): Promise<CharacterRow[]> {
  const result = await conn.execute<CharacterRow>(LIST_ALL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  logger.debug('캐릭터 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function insertCharacter(
  conn: oracledb.Connection,
  data: CharacterInsertData
): Promise<void> {
  await conn.execute(INSERT, data as unknown as Record<string, unknown>, { autoCommit: true });
  logger.info('캐릭터 생성', { charId: data.charId, name: data.name });
}

export async function updateCharacterStatus(
  conn: oracledb.Connection,
  charId: string,
  charType: string
): Promise<void> {
  await conn.execute(UPDATE_STATUS, { charType, charId }, { autoCommit: true });
  logger.info('캐릭터 상태 업데이트', { charId, charType });
}

export async function updateCharacterAnchor(
  conn: oracledb.Connection,
  charId: string,
  anchorBlob: Buffer,
  thumbnailBlob: Buffer,
  embedding: number[]
): Promise<void> {
  await conn.execute(UPDATE_ANCHOR, {
    charId,
    anchorBlob,
    thumbnailBlob,
    embedding: JSON.stringify(embedding),
  }, { autoCommit: true });
  logger.info('캐릭터 앵커 업데이트', { charId });
}
