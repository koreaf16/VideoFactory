/**
 * @module 블렌더 스크립트 생성 서비스
 * @description Python FastAPI를 경유하여 Claude CLI로 bpy 스크립트를 생성하고 저장한다.
 *
 * ┌──────────┐     ┌───────────┐     ┌──────────┐
 * │ Node.js  │ ──→ │ Python    │ ──→ │ Claude   │
 * │ Service  │     │ FastAPI   │     │ CLI      │
 * └──────────┘     └───────────┘     └──────────┘
 *        ↓                                 ↓
 *   Oracle DB                        bpy 스크립트
 *  (blender_script)                  (setup.py)
 *
 * @dependencies blender-prompt, location-queries, config
 * @author AI Video Factory
 */

import path from 'path';
import fs from 'fs/promises';
import { buildBlenderSystemPrompt, CAMERA_ANGLES } from '../templates/blender-prompt';
import { generateBlenderScript } from '../../python-api/endpoints/blender-api';
import { getConnection } from '../../db/connection';
import { updateBlenderScript } from '../../db/queries/location-queries';
import { ensureDir } from '../../common/utils/file-utils';
import { logger } from '../../common/logger';

// ─── 상수 ────────────────────────────────────────────────

const UPLOADS_BASE = path.resolve('uploads/locations');

// ─── 공개 타입 ───────────────────────────────────────────

export interface ScriptGenerationResult {
  readonly scriptPath: string;
  readonly cameraCount: number;
}

// ─── 공개 API ────────────────────────────────────────────

/**
 * 장소 설명을 바탕으로 bpy 스크립트를 생성하고 파일 및 DB에 저장한다.
 *
 * 1. 디렉토리 구조 확보 (blender/, depth_maps/, normal_maps/)
 * 2. 시스템 프롬프트 빌드
 * 3. Python API 호출 → Claude CLI → bpy 스크립트 반환
 * 4. 파일 저장: uploads/locations/{locationId}/blender/setup.py
 * 5. DB 저장: locations.blender_script
 */
export async function generateAndSaveBlenderScript(
  locationId: string,
  description: string,
): Promise<ScriptGenerationResult> {
  logger.info('블렌더 스크립트 생성 시작', { locationId });

  // 1. 디렉토리 확보
  const locDir = path.join(UPLOADS_BASE, locationId);
  const blenderDir = path.join(locDir, 'blender');
  const depthDir = path.join(locDir, 'depth_maps');
  const normalDir = path.join(locDir, 'normal_maps');

  await Promise.all([ensureDir(blenderDir), ensureDir(depthDir), ensureDir(normalDir)]);

  // 2. 시스템 프롬프트 빌드
  const systemPrompt = buildBlenderSystemPrompt({
    depthDir,
    normalDir,
    resolution: 1024,
  });

  // 3. Python API 호출 (Claude CLI subprocess, 최대 150초)
  logger.info('Python API 호출 중 (Claude CLI bpy 스크립트 생성)', { locationId });
  const result = await generateBlenderScript({
    description,
    system_prompt: systemPrompt,
  });

  const script = result.script;
  if (!script) {
    throw new Error('Python API가 빈 스크립트를 반환했습니다.');
  }

  // 4. 파일 저장
  const scriptPath = path.join(blenderDir, 'setup.py');
  await fs.writeFile(scriptPath, script, 'utf-8');
  logger.info('블렌더 스크립트 파일 저장 완료', {
    locationId,
    scriptPath,
    scriptLength: script.length,
  });

  // 5. DB 저장
  const conn = await getConnection();
  try {
    await updateBlenderScript(conn, locationId, script);
    logger.info('블렌더 스크립트 DB 저장 완료', { locationId });
  } finally {
    await conn.close();
  }

  return {
    scriptPath,
    cameraCount: CAMERA_ANGLES.length,
  };
}
