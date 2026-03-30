/**
 * @module 마스터 스크립트 서비스
 * @description 마스터 스크립트 등록, 조회, 수정 비즈니스 로직.
 *
 * ┌──────────┐     ┌────────────────────────┐     ┌──────────┐
 * │  Routes  │ ──→ │ master-script-service   │ ──→ │ Oracle   │
 * │  (HTTP)  │     │ (트랜잭션/로직)          │     │ 26ai DB  │
 * └──────────┘     └────────────────────────┘     └──────────┘
 *
 * @dependencies master-script-queries, oracledb
 * @author AI Video Factory
 */

import { getConnection } from '../../db/connection';
import {
  listMasterScripts,
  findMasterScriptById,
  insertMasterScript,
  updateMasterScript as updateMasterScriptQuery,
  listEpisodesByScript,
  deleteMasterScript as deleteMasterScriptQuery,
} from '../../db/queries/master-script-queries';
import { logger } from '../../common/logger';
import type {
  CreateMasterScriptRequest,
  UpdateMasterScriptRequest,
  MasterScriptDetail,
  MasterScriptSummary,
} from '../types/master-script.types';

// ─── 마스터 스크립트 생성 ────────────────────────────────

/** 마스터 스크립트를 생성하고 새 scriptId를 반환한다. */
export async function createMasterScript(
  req: CreateMasterScriptRequest,
): Promise<{ scriptId: number }> {
  const conn = await getConnection();
  try {
    const scriptId = await insertMasterScript(conn, {
      title: req.title,
      genre: req.genre ?? null,
      synopsis: req.synopsis ?? null,
      worldSetting: req.worldSetting ?? null,
    });
    logger.info('마스터 스크립트 생성 완료', { scriptId, title: req.title });
    return { scriptId };
  } finally {
    await conn.close();
  }
}

// ─── 마스터 스크립트 상세 조회 ───────────────────────────

/** 마스터 스크립트 기본 정보 + 소속 에피소드 목록을 반환한다. */
export async function getMasterScriptDetail(scriptId: number): Promise<MasterScriptDetail> {
  const conn = await getConnection();
  try {
    const row = await findMasterScriptById(conn, scriptId);
    if (!row) throw new Error(`마스터 스크립트를 찾을 수 없습니다: ${scriptId}`);

    const episodeRows = await listEpisodesByScript(conn, scriptId);

    return {
      scriptId: row.SCRIPT_ID,
      title: row.TITLE,
      genre: row.GENRE,
      synopsis: row.SYNOPSIS,
      worldSetting: row.WORLD_SETTING,
      status: row.STATUS,
      createdAt: row.CREATED_AT,
      updatedAt: row.UPDATED_AT,
      episodes: episodeRows.map((e) => ({
        epId: e.EP_ID,
        epNumber: e.EP_NUMBER,
        title: e.TITLE,
        status: e.STATUS,
        createdAt: e.CREATED_AT,
      })),
    };
  } finally {
    await conn.close();
  }
}

// ─── 마스터 스크립트 목록 조회 ───────────────────────────

/** 모든 마스터 스크립트의 요약 목록을 반환한다. */
export async function listAllMasterScripts(): Promise<MasterScriptSummary[]> {
  const conn = await getConnection();
  try {
    const rows = await listMasterScripts(conn);
    logger.debug('마스터 스크립트 목록 반환', { count: rows.length });
    return rows.map((r) => ({
      scriptId: r.SCRIPT_ID,
      title: r.TITLE,
      genre: r.GENRE,
      status: r.STATUS,
      createdAt: r.CREATED_AT,
    }));
  } finally {
    await conn.close();
  }
}

// ─── 마스터 스크립트 수정 ────────────────────────────────

/** 마스터 스크립트의 title, genre, synopsis, worldSetting을 수정한다. */
export async function updateMasterScript(
  scriptId: number,
  req: UpdateMasterScriptRequest,
): Promise<void> {
  const conn = await getConnection();
  try {
    const row = await findMasterScriptById(conn, scriptId);
    if (!row) throw new Error(`마스터 스크립트를 찾을 수 없습니다: ${scriptId}`);

    await updateMasterScriptQuery(conn, scriptId, {
      title: req.title ?? row.TITLE,
      genre: req.genre !== undefined ? (req.genre ?? null) : row.GENRE,
      synopsis: req.synopsis !== undefined ? (req.synopsis ?? null) : row.SYNOPSIS,
      worldSetting: req.worldSetting !== undefined ? (req.worldSetting ?? null) : row.WORLD_SETTING,
    });
    logger.info('마스터 스크립트 수정 완료', { scriptId });
  } finally {
    await conn.close();
  }
}

// ─── 마스터 스크립트 삭제 ────────────────────────────────

/** 마스터 스크립트를 삭제한다. 연관된 에피소드가 있으면 실패할 수 있다. */
export async function deleteMasterScript(scriptId: number): Promise<void> {
  const conn = await getConnection();
  try {
    const row = await findMasterScriptById(conn, scriptId);
    if (!row) throw new Error(`마스터 스크립트를 찾을 수 없습니다: ${scriptId}`);

    const episodeRows = await listEpisodesByScript(conn, scriptId);
    if (episodeRows.length > 0) {
      throw new Error(`에피소드가 포함된 마스터 대본은 삭제할 수 없습니다. 에피소드 수: ${episodeRows.length}`);
    }

    await deleteMasterScriptQuery(conn, scriptId);
    logger.info('마스터 스크립트 삭제 완료', { scriptId });
  } finally {
    await conn.close();
  }
}
