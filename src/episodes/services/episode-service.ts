/**
 * @module 에피소드 서비스
 * @description 에피소드 등록, 조회, 수정, 승인 비즈니스 로직.
 *
 * ┌──────────┐     ┌──────────────────┐     ┌──────────┐
 * │  Routes  │ ──→ │ episode-service   │ ──→ │ Oracle   │
 * │  (HTTP)  │     │ (트랜잭션/로직)    │     │ 26ai DB  │
 * └──────────┘     └──────────────────┘     └──────────┘
 *
 * @dependencies episode-queries, scene-queries, oracledb
 * @author AI Video Factory
 */

import { getConnection } from '../../db/connection';
import {
  insertEpisode,
  findEpisodeById,
  findByEpNumber,
  updateEpisode as updateEpisodeQuery,
  approveEpisode as approveEpisodeQuery,
  deleteEpisode as deleteEpisodeQuery,
} from '../../db/queries/episode-queries';
import {
  insertScene,
  findScenesByEpisode,
  findCharactersByScene,
  insertSceneCharacter,
  updateScene as updateSceneQuery,
  deleteSceneCharactersByEpisode,
  deleteScenesByEpisode,
} from '../../db/queries/scene-queries';
import { logger } from '../../common/logger';
import type {
  CreateEpisodeRequest,
  SceneScript,
  SceneDetail,
  EpisodeDetail,
} from '../types/episode.types';

// ─── 헬퍼 ──────────────────────────────────────────────────

function parseScript(raw: string | null): SceneScript | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SceneScript;
  } catch {
    logger.warn('씬 스크립트 JSON 파싱 실패', { raw: raw.slice(0, 100) });
    return null;
  }
}

// ─── 에피소드 생성 (트랜잭션) ───────────────────────────────

/**
 * 에피소드와 하위 씬을 트랜잭션으로 일괄 생성한다.
 * 중간에 오류 발생 시 롤백한다.
 */
// eslint-disable-next-line max-lines-per-function
export async function createEpisode(
  req: CreateEpisodeRequest,
): Promise<{ epId: number; sceneCount: number }> {
  const conn = await getConnection();
  try {
    const exists = await findByEpNumber(conn, req.epNumber);
    if (exists) throw new Error(`에피소드 번호 ${req.epNumber}이 이미 존재합니다.`);

    const epId = await insertEpisode(
      conn,
      {
        epNumber: req.epNumber,
        title: req.title,
        synopsis: req.synopsis ?? null,
        epType: req.epType ?? 'standard',
        scriptJson: null,
        worldState: null,
        decisionReasoning: req.decisionReasoning ?? null,
        scriptId: req.scriptId ?? null,
      },
      false,
    );

    for (const scene of req.scenes) {
      const sceneId = await insertScene(
        conn,
        {
          epId,
          sceneOrder: scene.sceneOrder,
          description: scene.description ?? null,
          locationId: scene.locationId ?? null,
          timeOfDay: scene.timeOfDay ?? null,
          cameraType: scene.cameraType ?? null,
          emotion: scene.emotion ?? null,
          durationSec: scene.durationSec ?? null,
          script: scene.script ? JSON.stringify(scene.script) : null,
          promptEn: scene.promptEn ?? null,
          motionPrompt: scene.motionPrompt ?? null,
        },
        false,
      );
      for (const charId of scene.characters ?? []) {
        await insertSceneCharacter(conn, sceneId, charId, false);
      }
    }

    await conn.commit();
    logger.info('에피소드 일괄 생성 완료', { epId, sceneCount: req.scenes.length });
    return { epId, sceneCount: req.scenes.length };
  } catch (err) {
    await conn.rollback();
    logger.error('에피소드 생성 실패 — 롤백', { epNumber: req.epNumber, error: String(err) });
    throw err;
  } finally {
    await conn.close();
  }
}

// ─── 에피소드 상세 조회 ─────────────────────────────────────

/** 에피소드 기본 정보 + 씬 목록 + 씬별 캐릭터를 조합해 반환한다. */
export async function getEpisodeDetail(epId: number): Promise<EpisodeDetail> {
  const conn = await getConnection();
  try {
    const ep = await findEpisodeById(conn, epId);
    if (!ep) throw new Error(`에피소드를 찾을 수 없습니다: ${epId}`);

    const sceneRows = await findScenesByEpisode(conn, epId);
    const scenes: SceneDetail[] = await Promise.all(
      sceneRows.map(async (r) => {
        const chars = await findCharactersByScene(conn, r.SCENE_ID);
        return {
          sceneId: r.SCENE_ID,
          sceneOrder: r.SCENE_ORDER,
          description: r.DESCRIPTION,
          locationId: r.LOCATION_ID,
          timeOfDay: r.TIME_OF_DAY,
          cameraType: r.CAMERA_TYPE,
          emotion: r.EMOTION,
          durationSec: r.DURATION_SEC,
          script: parseScript(r.SCRIPT),
          promptEn: r.PROMPT_EN,
          motionPrompt: r.MOTION_PROMPT,
          status: r.STATUS,
          characters: chars.map((c) => ({ charId: c.CHAR_ID, name: c.NAME })),
        };
      }),
    );

    return {
      epId: ep.EP_ID,
      epNumber: ep.EP_NUMBER,
      title: ep.TITLE,
      synopsis: ep.SYNOPSIS,
      epType: ep.EP_TYPE,
      status: ep.STATUS,
      scriptId: ep.SCRIPT_ID,
      createdAt: ep.CREATED_AT,
      approvedAt: ep.APPROVED_AT,
      publishedAt: ep.PUBLISHED_AT,
      scenes,
    };
  } finally {
    await conn.close();
  }
}

// ─── 에피소드 수정 ──────────────────────────────────────────

/** 에피소드의 title, synopsis, decisionReasoning 을 수정한다. */
export async function updateEpisode(
  epId: number,
  data: { title: string; synopsis: string | null; decisionReasoning: string | null },
): Promise<void> {
  const conn = await getConnection();
  try {
    const ep = await findEpisodeById(conn, epId);
    if (!ep) throw new Error(`에피소드를 찾을 수 없습니다: ${epId}`);
    await updateEpisodeQuery(conn, epId, data);
    logger.info('에피소드 수정 완료', { epId });
  } finally {
    await conn.close();
  }
}

// ─── 씬 수정 ────────────────────────────────────────────────

/** 개별 씬의 description, script, promptEn, motionPrompt 를 수정한다. */
export async function updateScene(
  sceneId: number,
  data: {
    description: string | null;
    script: string | null;
    promptEn: string | null;
    motionPrompt: string | null;
  },
): Promise<void> {
  const conn = await getConnection();
  try {
    await updateSceneQuery(conn, sceneId, data);
    logger.info('씬 수정 완료', { sceneId });
  } finally {
    await conn.close();
  }
}

// ─── 에피소드 승인 ──────────────────────────────────────────

/** 에피소드를 승인 상태로 변경한다. draft 또는 review 상태에서만 가능. */
export async function approveEpisode(epId: number): Promise<void> {
  const conn = await getConnection();
  try {
    const ep = await findEpisodeById(conn, epId);
    if (!ep) throw new Error(`에피소드를 찾을 수 없습니다: ${epId}`);
    if (!['draft', 'review'].includes(ep.STATUS)) {
      throw new Error(`승인 불가 상태입니다: ${ep.STATUS} (허용: draft, review)`);
    }
    await approveEpisodeQuery(conn, epId);
    logger.info('에피소드 승인 완료', { epId, prevStatus: ep.STATUS });
  } finally {
    await conn.close();
  }
}

// ─── 에피소드 삭제 ──────────────────────────────────────────

/**
 * 에피소드와 하위 씬을 함께 삭제한다. draft 상태에서만 가능.
 * 트랜잭션: scene_characters → scenes → episodes 순으로 삭제
 */
export async function deleteEpisode(epId: number): Promise<void> {
  const conn = await getConnection();
  try {
    const ep = await findEpisodeById(conn, epId);
    if (!ep) throw new Error(`에피소드를 찾을 수 없습니다: ${epId}`);
    if (ep.STATUS !== 'draft') {
      throw new Error(`삭제 불가 상태입니다: ${ep.STATUS} (허용: draft만)`);
    }

    // 트랜잭션: scene_characters → scenes → episodes 순으로 삭제
    await deleteSceneCharactersByEpisode(conn, epId);
    await deleteScenesByEpisode(conn, epId);
    await deleteEpisodeQuery(conn, epId);

    await conn.commit();
    logger.info('에피소드 삭제 완료', { epId, epNumber: ep.EP_NUMBER });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.close();
  }
}
