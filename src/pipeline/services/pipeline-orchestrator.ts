import oracledb from 'oracledb';
import { getConnection } from '../../db/connection';
import * as pq from '../../db/queries/pipeline-queries';
import * as sq from '../../db/queries/pipeline-step-queries';
import { PipelineStage, STAGE_ORDER } from '../types/pipeline.types';
import type { ProductionRun, AdvanceResult, CreateRunRequest } from '../types/pipeline.types';
import { logger } from '../../common/logger';

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

function rowToRun(row: pq.ProductionRunRow): ProductionRun {
  return {
    runId: row.RUN_ID,
    scriptId: row.SCRIPT_ID,
    protagonistId: row.PROTAGONIST_ID,
    currentStage: row.CURRENT_STAGE as PipelineStage,
    currentEpNum: row.CURRENT_EP_NUM,
    configJson: row.CONFIG_JSON ? (JSON.parse(row.CONFIG_JSON) as Record<string, unknown>) : null,
    errorMessage: row.ERROR_MESSAGE,
    autoAdvance: row.AUTO_ADVANCE === 1,
    createdAt: row.CREATED_AT,
    updatedAt: row.UPDATED_AT,
  };
}

async function requireRun(conn: oracledb.Connection, runId: number): Promise<pq.ProductionRunRow> {
  const row = await pq.findRunById(conn, runId);
  if (!row) throw new Error(`프로덕션 런을 찾을 수 없습니다: ${runId}`);
  return row;
}

export async function createRun(req: CreateRunRequest): Promise<ProductionRun> {
  const conn = await getConnection();
  try {
    const configJson = JSON.stringify({
      ...(req.config ?? {}),
      ...(req.protagonistPreset?.name ? { protagonistName: req.protagonistPreset.name } : {}),
    });
    const runId = await pq.insertRun(conn, {
      scriptId: req.scriptId ?? null,
      protagonistId: req.protagonistId ?? null,
      currentStage: PipelineStage.PROTAGONIST_PENDING,
      configJson,
      autoAdvance: 0,
    });
    if (req.protagonistPreset) {
      await sq.insertStep(conn, {
        runId,
        epId: null,
        stepType: 'protagonist_preset',
        inputJson: JSON.stringify(req.protagonistPreset),
      });
    }
    const row = await pq.findRunById(conn, runId);
    if (!row) throw new Error('생성된 런을 찾을 수 없습니다');
    logger.info('프로덕션 런 시작', { runId });
    return rowToRun(row);
  } finally {
    await conn.close();
  }
}

export async function listAllRuns(): Promise<ProductionRun[]> {
  const conn = await getConnection();
  try {
    return (await pq.listRuns(conn)).map(rowToRun);
  } finally {
    await conn.close();
  }
}

interface StepDetail {
  stepId: number;
  runId: number;
  epId: number | null;
  stepType: string;
  stepStatus: string;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export async function getRunDetail(
  runId: number,
): Promise<{ run: ProductionRun; steps: StepDetail[] }> {
  const conn = await getConnection();
  try {
    const row = await requireRun(conn, runId);
    const steps = await sq.findStepsByRun(conn, runId);
    return {
      run: rowToRun(row),
      steps: steps.map((s) => ({
        stepId: s.STEP_ID,
        runId: s.RUN_ID,
        epId: s.EP_ID,
        stepType: s.STEP_TYPE,
        stepStatus: s.STEP_STATUS,
        inputJson: s.INPUT_JSON ? (JSON.parse(s.INPUT_JSON) as unknown) : null,
        outputJson: s.OUTPUT_JSON ? (JSON.parse(s.OUTPUT_JSON) as unknown) : null,
        errorMessage: s.ERROR_MESSAGE,
        startedAt: s.STARTED_AT,
        completedAt: s.COMPLETED_AT,
        createdAt: s.CREATED_AT,
      })),
    };
  } finally {
    await conn.close();
  }
}

async function validateAdvance(
  conn: oracledb.Connection,
  run: ProductionRun,
): Promise<string | null> {
  switch (run.currentStage) {
    case PipelineStage.PROTAGONIST_PENDING:
      return run.protagonistId ? null : '주인공 캐릭터가 지정되지 않았습니다';

    case PipelineStage.PROTAGONIST_VISUAL: {
      if (!run.protagonistId) return '주인공 캐릭터가 없습니다';
      const r = await conn.execute<{ LORA_PATH: string | null }>(
        'SELECT lora_path FROM characters WHERE char_id = :charId',
        { charId: run.protagonistId },
        OBJ,
      );
      return r.rows?.[0]?.LORA_PATH
        ? null
        : '주인공 LoRA가 아직 등록되지 않았습니다. 앵커 → 파생 → LoRA 과정을 먼저 완료하세요';
    }

    case PipelineStage.SCRIPT_PENDING:
      return run.scriptId ? null : '마스터 대본이 지정되지 않았습니다';

    case PipelineStage.EPISODE_GENERATING: {
      if (!run.scriptId) return '마스터 대본이 지정되지 않았습니다';
      const r = await conn.execute<{ CNT: number }>(
        'SELECT COUNT(*) AS CNT FROM episodes WHERE script_id = :scriptId',
        { scriptId: run.scriptId },
        OBJ,
      );
      return (r.rows?.[0]?.CNT ?? 0) > 0
        ? null
        : '에피소드가 아직 없습니다. 에피소드를 먼저 생성하세요';
    }

    case PipelineStage.ASSETS_CREATING:
    case PipelineStage.SNAPSHOTS_GENERATING:
      return null;

    default:
      return `현재 스테이지(${run.currentStage})에서는 진행할 수 없습니다`;
  }
}

export async function advanceStage(runId: number): Promise<AdvanceResult> {
  const conn = await getConnection();
  try {
    const run = rowToRun(await requireRun(conn, runId));
    const error = await validateAdvance(conn, run);
    if (error) throw new Error(error);

    const idx = STAGE_ORDER.indexOf(run.currentStage);
    if (idx < 0 || idx >= STAGE_ORDER.length - 1) throw new Error('이미 완료된 파이프라인입니다');
    const next = STAGE_ORDER[idx + 1];

    await pq.updateRunStage(conn, runId, next, false);
    if (next !== PipelineStage.COMPLETED) {
      await sq.insertStep(conn, { runId, epId: null, stepType: next, inputJson: null }, false);
    }
    await conn.commit();
    logger.info('파이프라인 스테이지 진행', { runId, from: run.currentStage, to: next });
    return {
      previousStage: run.currentStage,
      currentStage: next,
      message: `${run.currentStage} → ${next} 진행 완료`,
    };
  } finally {
    await conn.close();
  }
}

export async function setProtagonist(runId: number, protagonistId: string): Promise<void> {
  const conn = await getConnection();
  try {
    await requireRun(conn, runId);
    await pq.updateRunProtagonist(conn, runId, protagonistId, false);
    await conn.execute(
      'UPDATE characters SET is_protagonist = 1 WHERE char_id = :charId',
      { charId: protagonistId },
      { autoCommit: false },
    );
    await conn.commit();
    logger.info('주인공 지정', { runId, protagonistId });
  } finally {
    await conn.close();
  }
}

export async function setScript(runId: number, scriptId: number): Promise<void> {
  const conn = await getConnection();
  try {
    await requireRun(conn, runId);
    await pq.updateRunScript(conn, runId, scriptId);
    logger.info('마스터 대본 지정', { runId, scriptId });
  } finally {
    await conn.close();
  }
}

export async function failRun(runId: number, errorMessage: string): Promise<void> {
  const conn = await getConnection();
  try {
    await pq.updateRunError(conn, runId, errorMessage);
    logger.error('프로덕션 런 실패', { runId, errorMessage });
  } finally {
    await conn.close();
  }
}
