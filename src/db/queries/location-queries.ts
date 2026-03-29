/**
 * @module 장소 쿼리
 * @description locations, location_candidates 테이블 SQL 쿼리.
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const LIST_LOCATIONS = `
  SELECT location_id, name, name_en, region_id, location_type,
         prompt_base, description, first_ep, created_at
    FROM locations
   ORDER BY created_at DESC
`;

export const FIND_LOCATION_BY_ID = `
  SELECT location_id, name, name_en, region_id, location_type,
         prompt_base, description, first_ep, created_at
    FROM locations
   WHERE location_id = :locationId
`;

export const INSERT_LOCATION = `
  INSERT INTO locations
    (location_id, name, name_en, location_type, prompt_base, description)
  VALUES
    (:locationId, :name, :nameEn, :locationType, :promptBase, :description)
`;

export const UPDATE_LOCATION_TYPE = `
  UPDATE locations
     SET location_type = :locationType
   WHERE location_id = :locationId
`;

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
   FETCH FIRST 1 ROWS ONLY
`;

// ─── 행 타입 ────────────────────────────────────────────

export interface LocationRow {
  LOCATION_ID: string;
  NAME: string;
  NAME_EN: string | null;
  REGION_ID: string | null;
  LOCATION_TYPE: string | null;
  PROMPT_BASE: string | null;
  DESCRIPTION: string | null;
  FIRST_EP: number | null;
  CREATED_AT: Date;
}

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

export async function listLocations(conn: oracledb.Connection): Promise<LocationRow[]> {
  const result = await conn.execute<LocationRow>(LIST_LOCATIONS, {}, OBJ);
  logger.debug('장소 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function findLocationById(
  conn: oracledb.Connection,
  locationId: string,
): Promise<LocationRow | undefined> {
  const result = await conn.execute<LocationRow>(FIND_LOCATION_BY_ID, { locationId }, OBJ);
  return result.rows?.[0];
}

export async function insertLocation(
  conn: oracledb.Connection,
  data: {
    locationId: string;
    name: string;
    nameEn: string | null;
    locationType: string | null;
    promptBase: string | null;
    description: string | null;
  },
): Promise<void> {
  await conn.execute(INSERT_LOCATION, data as unknown as Record<string, unknown>, {
    autoCommit: true,
  });
  logger.info('장소 생성', { locationId: data.locationId, name: data.name });
}

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
