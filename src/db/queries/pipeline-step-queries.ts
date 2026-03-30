import oracledb from 'oracledb';

// ─── SQL ────────────────────────────────────────────────

const INSERT_STEP = `
  INSERT INTO pipeline_steps (run_id, ep_id, step_type, step_status, input_json)
  VALUES (:runId, :epId, :stepType, 'pending', :inputJson)
  RETURNING step_id INTO :stepId
`;
const FIND_BY_RUN = `
  SELECT step_id, run_id, ep_id, step_type, step_status,
         input_json, output_json, error_message, started_at, completed_at, created_at
    FROM pipeline_steps WHERE run_id = :runId ORDER BY created_at ASC
`;
const FIND_BY_RUN_AND_TYPE = `
  SELECT step_id, run_id, ep_id, step_type, step_status,
         input_json, output_json, error_message, started_at, completed_at, created_at
    FROM pipeline_steps WHERE run_id = :runId AND step_type = :stepType ORDER BY created_at ASC
`;
const UPDATE_STATUS = `
  UPDATE pipeline_steps
     SET step_status   = :stepStatus,
         started_at    = CASE WHEN :stepStatus = 'running'
                              THEN SYSTIMESTAMP ELSE started_at END,
         completed_at  = CASE WHEN :stepStatus IN ('completed','failed','skipped')
                              THEN SYSTIMESTAMP ELSE completed_at END,
         output_json   = :outputJson,
         error_message = :errorMessage
   WHERE step_id = :stepId
`;

// ─── 행 타입 ────────────────────────────────────────────

export interface PipelineStepRow {
  STEP_ID: number;
  RUN_ID: number;
  EP_ID: number | null;
  STEP_TYPE: string;
  STEP_STATUS: string;
  INPUT_JSON: string | null;
  OUTPUT_JSON: string | null;
  ERROR_MESSAGE: string | null;
  STARTED_AT: Date | null;
  COMPLETED_AT: Date | null;
  CREATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

export async function insertStep(
  conn: oracledb.Connection,
  data: { runId: number; epId: number | null; stepType: string; inputJson: string | null },
  autoCommit = true,
): Promise<number> {
  const bindVars = { ...data, stepId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } };
  const result = await conn.execute(INSERT_STEP, bindVars, { autoCommit });
  return (result.outBinds as { stepId: number[] }).stepId[0];
}

export async function findStepsByRun(
  conn: oracledb.Connection,
  runId: number,
): Promise<PipelineStepRow[]> {
  const r = await conn.execute<PipelineStepRow>(FIND_BY_RUN, { runId }, OBJ);
  return r.rows ?? [];
}

export async function findStepsByRunAndType(
  conn: oracledb.Connection,
  runId: number,
  stepType: string,
): Promise<PipelineStepRow[]> {
  const r = await conn.execute<PipelineStepRow>(FIND_BY_RUN_AND_TYPE, { runId, stepType }, OBJ);
  return r.rows ?? [];
}

export async function updateStepStatus(
  conn: oracledb.Connection,
  stepId: number,
  data: { stepStatus: string; outputJson: string | null; errorMessage: string | null },
  autoCommit = true,
): Promise<void> {
  await conn.execute(UPDATE_STATUS, { stepId, ...data }, { autoCommit });
}
