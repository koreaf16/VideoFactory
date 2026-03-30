/**
 * @module 장소 후보/레퍼런스 이미지 쿼리
 * @description location_candidates, location_ref_images 테이블 SQL 쿼리.
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── 후보 SQL ────────────────────────────────────────────

export const INSERT_LOC_CANDIDATE = `
  INSERT INTO location_candidates
    (location_id, job_id, image_path, prompt_text, seed)
  VALUES
    (:locationId, :jobId, :imagePath, :promptText, :seed)
  RETURNING candidate_id INTO :candidateId
`;

export const LIST_LOC_CANDIDATES_BY_JOB = `
  SELECT candidate_id, location_id, job_id, image_path,
         prompt_text, seed, quality_score, liked, is_anchor, created_at
    FROM location_candidates
   WHERE job_id = :jobId
   ORDER BY candidate_id DESC
`;

export const LATEST_LOC_JOB = `
  SELECT job_id, MAX(created_at) AS last_created
    FROM location_candidates
   WHERE location_id = :locationId
   GROUP BY job_id
   ORDER BY last_created DESC
   FETCH FIRST 1 ROWS ONLY
`;

export const TOGGLE_LOC_LIKE = `
  UPDATE location_candidates
     SET liked = CASE WHEN liked = 1 THEN 0 ELSE 1 END
   WHERE candidate_id = :candidateId
`;

export const GET_LOC_LIKED_STATUS = `
  SELECT liked FROM location_candidates WHERE candidate_id = :candidateId
`;

export const SET_LOC_ANCHOR = `
  UPDATE location_candidates
     SET is_anchor = 1
   WHERE candidate_id = :candidateId
`;

export const CLEAR_LOC_ANCHORS_BY_LOC = `
  UPDATE location_candidates
     SET is_anchor = 0
   WHERE location_id = (SELECT location_id FROM location_candidates WHERE candidate_id = :candidateId)
`;

// ─── ref_images SQL ──────────────────────────────────────

export const LIST_LOC_REF_IMAGES = `
  SELECT ref_id, location_id, image_path, angle,
         time_of_day, weather, quality_score, is_anchor, approved, created_at
    FROM location_ref_images
   WHERE location_id = :locationId AND approved = 1
   ORDER BY created_at ASC
`;

export const COUNT_LOC_REF_IMAGES = `
  SELECT COUNT(*) AS CNT
    FROM location_ref_images
   WHERE location_id = :locationId AND approved = 1
`;

export const GET_LOC_ANCHOR_PATH = `
  SELECT image_path
    FROM location_candidates
   WHERE location_id = :locationId AND is_anchor = 1
   ORDER BY candidate_id DESC
   FETCH FIRST 1 ROWS ONLY
`;

// ─── 행 타입 ────────────────────────────────────────────

export interface LocCandidateRow {
  CANDIDATE_ID: number;
  LOCATION_ID: string;
  JOB_ID: string;
  IMAGE_PATH: string;
  PROMPT_TEXT: string | null;
  SEED: number | null;
  QUALITY_SCORE: number | null;
  LIKED: number;
  IS_ANCHOR: number;
  CREATED_AT: Date;
}

export interface LocRefImageRow {
  REF_ID: number;
  LOCATION_ID: string;
  IMAGE_PATH: string;
  ANGLE: string | null;
  TIME_OF_DAY: string | null;
  WEATHER: string | null;
  QUALITY_SCORE: number | null;
  IS_ANCHOR: number;
  APPROVED: number;
  CREATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

export async function insertLocCandidate(
  conn: oracledb.Connection,
  data: { locationId: string; jobId: string; imagePath: string; promptText: string; seed: number },
): Promise<number> {
  const binds = { ...data, candidateId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } };
  const result = await conn.execute(
    INSERT_LOC_CANDIDATE,
    binds as unknown as Record<string, unknown>,
    { autoCommit: true },
  );
  const outBinds = result.outBinds as unknown as { candidateId: number[] };
  return outBinds.candidateId[0];
}

export async function listLocCandidatesByJob(
  conn: oracledb.Connection,
  jobId: string,
): Promise<LocCandidateRow[]> {
  const result = await conn.execute<LocCandidateRow>(LIST_LOC_CANDIDATES_BY_JOB, { jobId }, OBJ);
  return result.rows ?? [];
}

export async function getLatestLocJob(
  conn: oracledb.Connection,
  locationId: string,
): Promise<string | null> {
  const result = await conn.execute<{ JOB_ID: string }>(LATEST_LOC_JOB, { locationId }, OBJ);
  return result.rows?.[0]?.JOB_ID ?? null;
}

export async function toggleLocCandidateLike(
  conn: oracledb.Connection,
  candidateId: number,
): Promise<number> {
  await conn.execute(TOGGLE_LOC_LIKE, { candidateId }, { autoCommit: true });
  const check = await conn.execute<{ LIKED: number }>(GET_LOC_LIKED_STATUS, { candidateId }, OBJ);
  return check.rows?.[0]?.LIKED ?? 0;
}

export async function setLocAnchorCandidate(
  conn: oracledb.Connection,
  candidateId: number,
): Promise<void> {
  await conn.execute(CLEAR_LOC_ANCHORS_BY_LOC, { candidateId }, { autoCommit: false });
  await conn.execute(SET_LOC_ANCHOR, { candidateId }, { autoCommit: true });
  logger.info('장소 앵커 설정', { candidateId });
}

export async function countLocRefImages(
  conn: oracledb.Connection,
  locationId: string,
): Promise<number> {
  const result = await conn.execute<{ CNT: number }>(COUNT_LOC_REF_IMAGES, { locationId }, OBJ);
  return result.rows?.[0]?.CNT ?? 0;
}

export async function getLocAnchorPath(
  conn: oracledb.Connection,
  locationId: string,
): Promise<string | null> {
  const result = await conn.execute<{ IMAGE_PATH: string }>(
    GET_LOC_ANCHOR_PATH,
    { locationId },
    OBJ,
  );
  return result.rows?.[0]?.IMAGE_PATH ?? null;
}
