/**
 * @module 마스터 스크립트 쿼리
 * @description master_scripts 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *              서비스 파일에서 인라인 SQL 없이 이 모듈을 import 해서 사용한다.
 *
 * ┌──────────────┐     ┌──────────────────────────┐     ┌──────────┐
 * │ Service      │ ──→ │ master-script-queries     │ ──→ │ Oracle   │
 * │ (비즈니스)    │     │ (SQL 정의)                │     │ 26ai DB  │
 * └──────────────┘     └──────────────────────────┘     └──────────┘
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const LIST_ALL = `
  SELECT script_id, title, genre, synopsis, world_setting, status, created_at, updated_at
    FROM master_scripts
   ORDER BY created_at DESC
`;

export const FIND_BY_ID = `
  SELECT script_id, title, genre, synopsis, world_setting, status, created_at, updated_at
    FROM master_scripts
   WHERE script_id = :scriptId
`;

export const INSERT = `
  INSERT INTO master_scripts
    (title, genre, synopsis, world_setting)
  VALUES
    (:title, :genre, :synopsis, :worldSetting)
  RETURNING script_id INTO :scriptId
`;

export const UPDATE = `
  UPDATE master_scripts
     SET title         = :title,
         genre         = :genre,
         synopsis      = :synopsis,
         world_setting = :worldSetting,
         updated_at    = SYSTIMESTAMP
   WHERE script_id = :scriptId
`;

export const UPDATE_STATUS = `
  UPDATE master_scripts
     SET status     = :status,
         updated_at = SYSTIMESTAMP
   WHERE script_id = :scriptId
`;

export const LIST_EPISODES_BY_SCRIPT = `
  SELECT ep_id, ep_number, title, status, created_at
    FROM episodes
   WHERE script_id = :scriptId
   ORDER BY ep_number ASC
`;

// ─── 행 타입 ────────────────────────────────────────────

export interface MasterScriptRow {
  SCRIPT_ID: number;
  TITLE: string;
  GENRE: string | null;
  SYNOPSIS: string | null;
  WORLD_SETTING: string | null;
  STATUS: string;
  CREATED_AT: Date;
  UPDATED_AT: Date;
}

export interface ScriptEpisodeRow {
  EP_ID: number;
  EP_NUMBER: number;
  TITLE: string | null;
  STATUS: string;
  CREATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

export async function listMasterScripts(conn: oracledb.Connection): Promise<MasterScriptRow[]> {
  const result = await conn.execute<MasterScriptRow>(LIST_ALL, {}, OBJ);
  logger.debug('마스터 스크립트 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function findMasterScriptById(
  conn: oracledb.Connection,
  scriptId: number,
): Promise<MasterScriptRow | undefined> {
  const result = await conn.execute<MasterScriptRow>(FIND_BY_ID, { scriptId }, OBJ);
  logger.debug('마스터 스크립트 조회', { scriptId, found: (result.rows?.length ?? 0) > 0 });
  return result.rows?.[0];
}

export async function insertMasterScript(
  conn: oracledb.Connection,
  data: {
    title: string;
    genre: string | null;
    synopsis: string | null;
    worldSetting: string | null;
  },
  autoCommit = true,
): Promise<number> {
  const bindVars = {
    ...data,
    scriptId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT, bindVars, { autoCommit });
  const newId = (result.outBinds as { scriptId: number[] }).scriptId[0];
  logger.info('마스터 스크립트 생성', { scriptId: newId, title: data.title });
  return newId;
}

export async function updateMasterScript(
  conn: oracledb.Connection,
  scriptId: number,
  data: {
    title: string;
    genre: string | null;
    synopsis: string | null;
    worldSetting: string | null;
  },
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE, { scriptId, ...data }, { autoCommit });
  logger.info('마스터 스크립트 수정', { scriptId });
}

export async function updateMasterScriptStatus(
  conn: oracledb.Connection,
  scriptId: number,
  status: string,
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_STATUS, { scriptId, status }, { autoCommit });
  logger.info('마스터 스크립트 상태 변경', { scriptId, status });
}

export async function listEpisodesByScript(
  conn: oracledb.Connection,
  scriptId: number,
): Promise<ScriptEpisodeRow[]> {
  const result = await conn.execute<ScriptEpisodeRow>(LIST_EPISODES_BY_SCRIPT, { scriptId }, OBJ);
  logger.debug('스크립트별 에피소드 목록 조회', { scriptId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}
