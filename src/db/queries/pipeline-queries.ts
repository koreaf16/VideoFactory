import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL ────────────────────────────────────────────────

const INSERT_RUN = `
  INSERT INTO production_runs
    (script_id, protagonist_id, current_stage, config_json, auto_advance)
  VALUES (:scriptId, :protagonistId, :currentStage, :configJson, :autoAdvance)
  RETURNING run_id INTO :runId
`;
const FIND_RUN_BY_ID = `
  SELECT run_id, script_id, protagonist_id, current_stage,
         current_ep_num, config_json, error_message, auto_advance,
         created_at, updated_at
    FROM production_runs WHERE run_id = :runId
`;
const LIST_RUNS = `
  SELECT run_id, script_id, protagonist_id, current_stage,
         current_ep_num, auto_advance, created_at, updated_at
    FROM production_runs ORDER BY created_at DESC FETCH FIRST 50 ROWS ONLY
`;
const UPDATE_STAGE = `UPDATE production_runs
   SET current_stage = :currentStage, updated_at = SYSTIMESTAMP WHERE run_id = :runId`;
const UPDATE_EP_NUM = `UPDATE production_runs
   SET current_ep_num = :epNum, updated_at = SYSTIMESTAMP WHERE run_id = :runId`;
const UPDATE_SCRIPT = `UPDATE production_runs
   SET script_id = :scriptId, updated_at = SYSTIMESTAMP WHERE run_id = :runId`;
const UPDATE_PROTAGONIST = `UPDATE production_runs
   SET protagonist_id = :protagonistId, updated_at = SYSTIMESTAMP WHERE run_id = :runId`;
const UPDATE_ERROR = `UPDATE production_runs
   SET current_stage = 'failed', error_message = :errorMessage,
       updated_at = SYSTIMESTAMP WHERE run_id = :runId`;

// ─── 행 타입 ────────────────────────────────────────────

export interface ProductionRunRow {
  RUN_ID: number;
  SCRIPT_ID: number | null;
  PROTAGONIST_ID: string | null;
  CURRENT_STAGE: string;
  CURRENT_EP_NUM: number;
  CONFIG_JSON: string | null;
  ERROR_MESSAGE: string | null;
  AUTO_ADVANCE: number;
  CREATED_AT: Date;
  UPDATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

export async function insertRun(
  conn: oracledb.Connection,
  data: {
    scriptId: number | null;
    protagonistId: string | null;
    currentStage: string;
    configJson: string | null;
    autoAdvance: number;
  },
  autoCommit = true,
): Promise<number> {
  const bindVars = { ...data, runId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } };
  const result = await conn.execute(INSERT_RUN, bindVars, { autoCommit });
  const newId = (result.outBinds as { runId: number[] }).runId[0];
  logger.info('프로덕션 런 생성', { runId: newId });
  return newId;
}

export async function findRunById(
  conn: oracledb.Connection,
  runId: number,
): Promise<ProductionRunRow | undefined> {
  const r = await conn.execute<ProductionRunRow>(FIND_RUN_BY_ID, { runId }, OBJ);
  return r.rows?.[0];
}

export async function listRuns(conn: oracledb.Connection): Promise<ProductionRunRow[]> {
  const r = await conn.execute<ProductionRunRow>(LIST_RUNS, {}, OBJ);
  return r.rows ?? [];
}

export async function updateRunStage(
  conn: oracledb.Connection,
  runId: number,
  currentStage: string,
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_STAGE, { runId, currentStage }, { autoCommit });
  logger.info('프로덕션 런 스테이지 변경', { runId, currentStage });
}

export async function updateRunEpNum(
  conn: oracledb.Connection,
  runId: number,
  epNum: number,
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_EP_NUM, { runId, epNum }, { autoCommit });
}

export async function updateRunScript(
  conn: oracledb.Connection,
  runId: number,
  scriptId: number,
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_SCRIPT, { runId, scriptId }, { autoCommit });
}

export async function updateRunProtagonist(
  conn: oracledb.Connection,
  runId: number,
  protagonistId: string,
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_PROTAGONIST, { runId, protagonistId }, { autoCommit });
}

export async function updateRunError(
  conn: oracledb.Connection,
  runId: number,
  errorMessage: string,
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_ERROR, { runId, errorMessage }, { autoCommit });
}
