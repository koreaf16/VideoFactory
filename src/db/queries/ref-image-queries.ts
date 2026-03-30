/**
 * @module 파생 이미지 쿼리
 * @description char_ref_images 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const LIST_REF_IMAGES_BY_CHAR = `
  SELECT ref_id, char_id, image_blob, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE char_id = :charId AND approved = 1
   ORDER BY created_at ASC
`;

export const LIST_ALL_REF_IMAGES_BY_CHAR = `
  SELECT ref_id, char_id, image_blob, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE char_id = :charId
   ORDER BY created_at ASC
`;

export const GET_REF_IMAGE = `
  SELECT ref_id, char_id, image_blob, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE ref_id = :refId
`;

export const DELETE_REF_IMAGE = `
  DELETE FROM char_ref_images WHERE ref_id = :refId
`;

export const GET_ANCHOR_BLOB = `
  SELECT image_blob
    FROM char_candidates
   WHERE char_id = :charId AND is_anchor = 1
   ORDER BY candidate_id DESC
   FETCH FIRST 1 ROWS ONLY
`;

export const GET_ANCHOR_ID = `
  SELECT candidate_id
    FROM char_candidates
   WHERE char_id = :charId AND is_anchor = 1
   ORDER BY candidate_id DESC
   FETCH FIRST 1 ROWS ONLY
`;

export const COUNT_REF_IMAGES_BY_CHAR = `
  SELECT COUNT(*) AS CNT
    FROM char_ref_images
   WHERE char_id = :charId AND approved = 1
`;

export const LIST_CUSTOM_REF_IMAGES = `
  SELECT ref_id, image_blob, pose_tag
    FROM char_ref_images
   WHERE char_id = :charId AND is_custom = 1
   ORDER BY created_at ASC
`;

export const DELETE_NON_CUSTOM_REF_IMAGES = `
  DELETE FROM char_ref_images
   WHERE char_id = :charId AND (is_custom = 0 OR is_custom IS NULL)
`;

// ─── 타입 ────────────────────────────────────────────────

export interface RefImageRow {
  REF_ID: number;
  CHAR_ID: string;
  IMAGE_BLOB: Buffer;
  POSE_TAG: string | null;
  QUALITY_SCORE: number | null;
  APPROVED: number;
  CREATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

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

export async function listAllRefImagesByChar(
  conn: oracledb.Connection,
  charId: string,
): Promise<RefImageRow[]> {
  const result = await conn.execute<RefImageRow>(
    LIST_ALL_REF_IMAGES_BY_CHAR,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('파생 이미지 전체 목록 조회', { charId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function batchApproveRefImages(
  conn: oracledb.Connection,
  charId: string,
  refIds: number[],
  approved: boolean,
): Promise<number> {
  if (refIds.length === 0) return 0;
  const approvedNum = approved ? 1 : 0;
  const result = await conn.executeMany(
    'UPDATE char_ref_images SET approved = :approved WHERE ref_id = :refId AND char_id = :charId',
    refIds.map((id) => ({ refId: id, approved: approvedNum, charId })),
    { autoCommit: true },
  );
  const updated = result.rowsAffected ?? 0;
  logger.info('파생 이미지 일괄 승인 업데이트', { count: refIds.length, approved, updated });
  return updated;
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

export async function getAnchorBlob(
  conn: oracledb.Connection,
  charId: string,
): Promise<Buffer | null> {
  const result = await conn.execute<{ IMAGE_BLOB: Buffer }>(
    GET_ANCHOR_BLOB,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.IMAGE_BLOB ?? null;
}

export async function getAnchorId(
  conn: oracledb.Connection,
  charId: string,
): Promise<number | null> {
  const result = await conn.execute<{ CANDIDATE_ID: number }>(
    GET_ANCHOR_ID,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.CANDIDATE_ID ?? null;
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

