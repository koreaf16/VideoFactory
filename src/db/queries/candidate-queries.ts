/**
 * @module 후보 이미지 쿼리
 * @description char_candidates 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *              서비스 파일에서 인라인 SQL 없이 이 모듈을 import 해서 사용한다.
 *
 * ┌──────────────┐     ┌──────────────────┐     ┌──────────┐
 * │ Service      │ ──→ │ candidate-queries│ ──→ │ Oracle   │
 * │ (비즈니스)    │     │ (SQL 정의)        │     │ 26ai DB  │
 * └──────────────┘     └──────────────────┘     └──────────┘
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const INSERT_CANDIDATE = `
  INSERT INTO char_candidates
    (char_id, job_id, image_path, prompt_text, seed, quality_score, grade)
  VALUES
    (:charId, :jobId, :imagePath, :promptText, :seed, :qualityScore, :grade)
  RETURNING candidate_id INTO :candidateId
`;

export const LIST_BY_JOB = `
  SELECT candidate_id, char_id, job_id, image_path,
         prompt_text, seed, quality_score, grade,
         liked, is_anchor, created_at
    FROM char_candidates
   WHERE job_id = :jobId
   ORDER BY candidate_id DESC
`;

export const LIST_BY_CHAR = `
  SELECT candidate_id, char_id, job_id, image_path,
         prompt_text, seed, quality_score, grade,
         liked, is_anchor, created_at
    FROM char_candidates
   WHERE char_id = :charId
   ORDER BY candidate_id DESC
`;

export const LATEST_JOB_BY_CHAR = `
  SELECT job_id, MAX(created_at) AS last_created
    FROM char_candidates
   WHERE char_id = :charId
   GROUP BY job_id
   ORDER BY last_created DESC
   FETCH FIRST 1 ROWS ONLY
`;

export const TOGGLE_LIKE = `
  UPDATE char_candidates
     SET liked = CASE WHEN liked = 1 THEN 0 ELSE 1 END
   WHERE candidate_id = :candidateId
`;

export const SET_ANCHOR = `
  UPDATE char_candidates
     SET is_anchor = 1
   WHERE candidate_id = :candidateId
`;

export const GET_LIKED_STATUS = `
  SELECT liked FROM char_candidates WHERE candidate_id = :candidateId
`;

export const GET_LIKED = `
  SELECT candidate_id, char_id, job_id, image_path,
         prompt_text, seed, quality_score, grade,
         liked, is_anchor, created_at
    FROM char_candidates
   WHERE job_id = :jobId AND liked = 1
   ORDER BY quality_score DESC NULLS LAST
`;

// ─── 행 타입 ────────────────────────────────────────────

export interface CandidateRow {
  CANDIDATE_ID: number;
  CHAR_ID: string;
  JOB_ID: string;
  IMAGE_PATH: string;
  PROMPT_TEXT: string | null;
  SEED: number | null;
  QUALITY_SCORE: number | null;
  GRADE: string | null;
  LIKED: number;
  IS_ANCHOR: number;
  CREATED_AT: Date;
}

interface CandidateInsertData {
  charId: string;
  jobId: string;
  imagePath: string;
  promptText: string;
  seed: number;
  qualityScore: number | null;
  grade: string | null;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

export async function insertCandidate(
  conn: oracledb.Connection,
  data: CandidateInsertData
): Promise<number> {
  const binds = {
    ...data,
    candidateId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT_CANDIDATE, binds as unknown as Record<string, unknown>, { autoCommit: true });
  const outBinds = result.outBinds as unknown as { candidateId: number[] };
  const candidateId = outBinds.candidateId[0];
  logger.debug('후보 이미지 저장', { charId: data.charId, jobId: data.jobId, candidateId });
  return candidateId;
}

export async function listCandidatesByJob(
  conn: oracledb.Connection,
  jobId: string
): Promise<CandidateRow[]> {
  const result = await conn.execute<CandidateRow>(LIST_BY_JOB, { jobId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  logger.debug('후보 목록 조회', { jobId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function listCandidatesByChar(
  conn: oracledb.Connection,
  charId: string
): Promise<CandidateRow[]> {
  const result = await conn.execute<CandidateRow>(LIST_BY_CHAR, { charId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  logger.debug('캐릭터 전체 후보 조회', { charId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function getLatestJobByChar(
  conn: oracledb.Connection,
  charId: string
): Promise<string | null> {
  const result = await conn.execute<{ JOB_ID: string }>(
    LATEST_JOB_BY_CHAR, { charId }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return result.rows?.[0]?.JOB_ID ?? null;
}

export async function toggleCandidateLike(
  conn: oracledb.Connection,
  candidateId: number
): Promise<number> {
  await conn.execute(TOGGLE_LIKE, { candidateId }, { autoCommit: true });
  const check = await conn.execute<{ LIKED: number }>(
    GET_LIKED_STATUS,
    { candidateId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const newValue = check.rows?.[0]?.LIKED ?? 0;
  logger.debug('후보 좋아요 토글', { candidateId, liked: newValue });
  return newValue;
}

export async function setAnchorCandidate(
  conn: oracledb.Connection,
  candidateId: number
): Promise<void> {
  await conn.execute(SET_ANCHOR, { candidateId }, { autoCommit: true });
  logger.info('앵커 후보 설정', { candidateId });
}

export async function getLikedCandidates(
  conn: oracledb.Connection,
  jobId: string
): Promise<CandidateRow[]> {
  const result = await conn.execute<CandidateRow>(GET_LIKED, { jobId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  logger.debug('좋아요 후보 조회', { jobId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}
