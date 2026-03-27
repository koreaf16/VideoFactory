/**
 * @module 씬 쿼리
 * @description scenes 테이블에 대한 모든 SQL 쿼리를 정의한다.
 *              서비스 파일에서 인라인 SQL 없이 이 모듈을 import 해서 사용한다.
 *
 * ┌──────────────┐     ┌──────────────────┐     ┌──────────┐
 * │ Service      │ ──→ │ scene-queries     │ ──→ │ Oracle   │
 * │ (비즈니스)    │     │ (SQL 정의)        │     │ 26ai DB  │
 * └──────────────┘     └──────────────────┘     └──────────┘
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const FIND_BY_EPISODE = `
  SELECT scene_id, ep_id, scene_order, description,
         location_id, time_of_day, camera_type, emotion,
         duration_sec, script, prompt_en, motion_prompt,
         status, keyframe_path, video_path, upscaled_path,
         tts_path, quality_score, created_at
    FROM scenes
   WHERE ep_id = :epId
   ORDER BY scene_order ASC
`;

export const INSERT = `
  INSERT INTO scenes
    (ep_id, scene_order, description, location_id,
     time_of_day, camera_type, emotion, duration_sec,
     script, prompt_en, motion_prompt)
  VALUES
    (:epId, :sceneOrder, :description, :locationId,
     :timeOfDay, :cameraType, :emotion, :durationSec,
     :script, :promptEn, :motionPrompt)
  RETURNING scene_id INTO :sceneId
`;

export const UPDATE_STATUS = `
  UPDATE scenes
     SET status = :status
   WHERE scene_id = :sceneId
`;

export const UPDATE_KEYFRAME = `
  UPDATE scenes
     SET keyframe_path = :keyframePath,
         keyframe_blob = :keyframeBlob,
         status        = 'keyframed'
   WHERE scene_id = :sceneId
`;

export const UPDATE_VIDEO = `
  UPDATE scenes
     SET video_path    = :videoPath,
         upscaled_path = :upscaledPath,
         quality_score = :qualityScore,
         status        = 'rendered'
   WHERE scene_id = :sceneId
`;

// ─── 타입 정의 ──────────────────────────────────────────

interface SceneRow {
  SCENE_ID: number;
  EP_ID: number;
  SCENE_ORDER: number;
  DESCRIPTION: string | null;
  LOCATION_ID: string | null;
  STATUS: string;
  KEYFRAME_PATH: string | null;
  VIDEO_PATH: string | null;
  CREATED_AT: Date;
}

interface SceneInsertData {
  epId: number;
  sceneOrder: number;
  description: string | null;
  locationId: string | null;
  timeOfDay: string | null;
  cameraType: string | null;
  emotion: string | null;
  durationSec: number | null;
  script: string | null;
  promptEn: string | null;
  motionPrompt: string | null;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

export async function findScenesByEpisode(
  conn: oracledb.Connection,
  epId: number
): Promise<SceneRow[]> {
  const result = await conn.execute<SceneRow>(FIND_BY_EPISODE, { epId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  logger.debug('씬 목록 조회', { epId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function insertScene(
  conn: oracledb.Connection,
  data: SceneInsertData
): Promise<number> {
  const bindVars = {
    ...data,
    sceneId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT, bindVars, { autoCommit: true });
  const newId = (result.outBinds as { sceneId: number[] }).sceneId[0];
  logger.info('씬 생성', { sceneId: newId, epId: data.epId });
  return newId;
}

export async function updateSceneKeyframe(
  conn: oracledb.Connection,
  sceneId: number,
  keyframePath: string,
  keyframeBlob: Buffer
): Promise<void> {
  await conn.execute(UPDATE_KEYFRAME, { sceneId, keyframePath, keyframeBlob }, { autoCommit: true });
  logger.info('씬 키프레임 업데이트', { sceneId });
}

export async function updateSceneVideo(
  conn: oracledb.Connection,
  sceneId: number,
  videoPath: string,
  upscaledPath: string | null,
  qualityScore: number | null
): Promise<void> {
  await conn.execute(UPDATE_VIDEO, { sceneId, videoPath, upscaledPath, qualityScore }, { autoCommit: true });
  logger.info('씬 비디오 업데이트', { sceneId });
}
