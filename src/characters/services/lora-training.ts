/**
 * @module LoRA 학습 서비스
 * @description ComfyUI FluxTrainer 기반 LoRA 학습, 진행률 모니터링,
 *              체크포인트 관리, 추론 테스트, 체크포인트 선택을 처리한다.
 *
 * ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌───────────┐
 * │ Training │→ │ ComfyUI   │→ │ Checkpoint │→ │ Inference │
 * │ Start    │  │ Flux      │  │ DB 저장    │  │ Test      │
 * └──────────┘  └───────────┘  └────────────┘  └───────────┘
 *
 * @dependencies lora-executor, lora-db-helpers, db
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';
import { getConnection } from '../../db/connection';
import {
  INSERT_TRAINING_JOB,
  GET_TRAINING_JOB,
  UPDATE_TRAINING_STATUS,
  LIST_CHECKPOINTS,
  SELECT_CHECKPOINT,
  GET_CHECKPOINT,
  UPDATE_CHARACTER_LORA,
} from '../../db/queries/lora-queries';
import type { TrainingJobRow, CheckpointRow } from '../../db/queries/lora-queries';
import { DEFAULT_TRAINING_CONFIG } from '../types/lora.types';
import type { LoraTrainingConfig } from '../types/lora.types';
import { executeTraining, runTestCheckpoint } from './lora-executor';
import { execSql, queryOne } from './lora-db-helpers';
import { logger } from '../../common/logger';

export const trainingEvents = new EventEmitter();
trainingEvents.setMaxListeners(50);

// ─── 학습 시작 ─────────────────────────────────────────

export async function startTraining(
  charId: string,
  datasetId: string,
  userConfig?: Partial<LoraTrainingConfig>,
): Promise<string> {
  const jobId = randomUUID();
  const merged: LoraTrainingConfig = { ...DEFAULT_TRAINING_CONFIG, ...userConfig };
  await execSql(INSERT_TRAINING_JOB, {
    jobId,
    datasetId,
    charId,
    status: 'queued',
    config: JSON.stringify(merged),
    totalSteps: merged.maxTrainSteps,
  });

  executeTraining(jobId, charId, datasetId, merged, trainingEvents).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('학습 실행 실패', { jobId, error: msg });
    execSql(UPDATE_TRAINING_STATUS, { jobId, status: 'failed', errorMessage: msg }).catch(() => {});
  });

  logger.info('학습 작업 생성', { jobId, charId, datasetId });
  return jobId;
}

// ─── 조회 ──────────────────────────────────────────────

export async function getTrainingJob(jobId: string): Promise<TrainingJobRow | null> {
  return queryOne<TrainingJobRow>(GET_TRAINING_JOB, { jobId });
}

export async function listCheckpoints(jobId: string): Promise<CheckpointRow[]> {
  const conn = await getConnection();
  try {
    const r = await conn.execute<CheckpointRow>(
      LIST_CHECKPOINTS,
      { jobId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  } finally {
    await conn.close();
  }
}

// ─── 체크포인트 추론 테스트 ────────────────────────────

export async function testCheckpoint(
  charId: string,
  checkpointId: string,
  triggerWord: string,
  loraStrength?: number,
): Promise<void> {
  return runTestCheckpoint(charId, checkpointId, triggerWord, loraStrength, trainingEvents);
}

// ─── 체크포인트 선택 ──────────────────────────────────

export async function selectCheckpoint(
  charId: string,
  jobId: string,
  checkpointId: string,
): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(SELECT_CHECKPOINT, { checkpointId, jobId });
    const r = await conn.execute<CheckpointRow>(
      GET_CHECKPOINT,
      { checkpointId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) throw new Error(`체크포인트를 찾을 수 없음: ${checkpointId}`);
    await conn.execute(UPDATE_CHARACTER_LORA, { charId, loraPath: row.FILE_NAME });
    await conn.commit();
    logger.info('체크포인트 선택 완료', { charId, jobId, checkpointId, fileName: row.FILE_NAME });
  } finally {
    await conn.close();
  }
}
