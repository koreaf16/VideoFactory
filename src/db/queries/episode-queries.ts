/**
 * @module 에피소드 쿼리
 * @description episodes 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *              서비스 파일에서 인라인 SQL 없이 이 모듈을 import 해서 사용한다.
 *
 * ┌──────────────┐     ┌──────────────────┐     ┌──────────┐
 * │ Service      │ ──→ │ episode-queries   │ ──→ │ Oracle   │
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
  SELECT ep_id, ep_number, title, synopsis, ep_type,
         status, script_json, world_state,
         decision_reasoning, script_id, created_at, approved_at, published_at
    FROM episodes
   WHERE ep_id = :epId
`;

export const LIST_ALL = `
  SELECT ep_id, ep_number, title, synopsis, ep_type,
         status, script_id, created_at, approved_at, published_at
    FROM episodes
   ORDER BY ep_number DESC
`;

export const LIST_BY_SCRIPT = `
  SELECT ep_id, ep_number, title, synopsis, ep_type,
         status, script_id, created_at, approved_at, published_at
    FROM episodes
   WHERE script_id = :scriptId
   ORDER BY ep_number ASC
`;

export const INSERT = `
  INSERT INTO episodes
    (ep_number, title, synopsis, ep_type, script_json,
     world_state, decision_reasoning, script_id)
  VALUES
    (:epNumber, :title, :synopsis, :epType, :scriptJson,
     :worldState, :decisionReasoning, :scriptId)
  RETURNING ep_id INTO :epId
`;

export const UPDATE_STATUS = `
  UPDATE episodes
     SET status = :status
   WHERE ep_id = :epId
`;

export const APPROVE = `
  UPDATE episodes
     SET status      = 'approved',
         approved_at = SYSTIMESTAMP
   WHERE ep_id = :epId
`;

export const UPDATE_EPISODE = `
  UPDATE episodes
     SET title              = :title,
         synopsis           = :synopsis,
         decision_reasoning = :decisionReasoning
   WHERE ep_id = :epId
`;

export const FIND_BY_EP_NUMBER = `
  SELECT ep_id FROM episodes WHERE ep_number = :epNumber
`;

// ─── 타입 정의 ──────────────────────────────────────────

interface EpisodeRow {
  EP_ID: number;
  EP_NUMBER: number;
  TITLE: string | null;
  SYNOPSIS: string | null;
  EP_TYPE: string;
  STATUS: string;
  SCRIPT_ID: number | null;
  CREATED_AT: Date;
  APPROVED_AT: Date | null;
  PUBLISHED_AT: Date | null;
}

interface EpisodeInsertData {
  epNumber: number;
  title: string | null;
  synopsis: string | null;
  epType: string;
  scriptJson: string | null;
  worldState: string | null;
  decisionReasoning: string | null;
  scriptId: number | null;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

export async function findEpisodeById(
  conn: oracledb.Connection,
  epId: number,
): Promise<EpisodeRow | undefined> {
  const result = await conn.execute<EpisodeRow>(
    FIND_BY_ID,
    { epId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('에피소드 조회', { epId, found: (result.rows?.length ?? 0) > 0 });
  return result.rows?.[0];
}

export async function listEpisodes(conn: oracledb.Connection): Promise<EpisodeRow[]> {
  const result = await conn.execute<EpisodeRow>(
    LIST_ALL,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('에피소드 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function insertEpisode(
  conn: oracledb.Connection,
  data: EpisodeInsertData,
  autoCommit = true,
): Promise<number> {
  const bindVars = {
    ...data,
    epId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT, bindVars, { autoCommit });
  const newId = (result.outBinds as { epId: number[] }).epId[0];
  logger.info('에피소드 생성', { epId: newId, epNumber: data.epNumber });
  return newId;
}

export async function updateEpisodeStatus(
  conn: oracledb.Connection,
  epId: number,
  status: string,
): Promise<void> {
  await conn.execute(UPDATE_STATUS, { epId, status }, { autoCommit: true });
  logger.info('에피소드 상태 변경', { epId, status });
}

export async function approveEpisode(conn: oracledb.Connection, epId: number): Promise<void> {
  await conn.execute(APPROVE, { epId }, { autoCommit: true });
  logger.info('에피소드 승인', { epId });
}

export async function updateEpisode(
  conn: oracledb.Connection,
  epId: number,
  data: { title: string | null; synopsis: string | null; decisionReasoning: string | null },
): Promise<void> {
  await conn.execute(UPDATE_EPISODE, { epId, ...data }, { autoCommit: true });
  logger.info('에피소드 수정', { epId });
}

export async function findByEpNumber(
  conn: oracledb.Connection,
  epNumber: number,
): Promise<boolean> {
  const result = await conn.execute<{ EP_ID: number }>(
    FIND_BY_EP_NUMBER,
    { epNumber },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return (result.rows?.length ?? 0) > 0;
}

export async function listEpisodesByScript(
  conn: oracledb.Connection,
  scriptId: number,
): Promise<EpisodeRow[]> {
  const result = await conn.execute<EpisodeRow>(
    LIST_BY_SCRIPT,
    { scriptId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('스크립트별 에피소드 목록 조회', { scriptId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}
