/**
 * @module 블렌더 렌더러 서비스
 * @description Blender CLI headless를 실행하여 depth/normal map을 렌더링하고 결과를 검증한다.
 *
 * ┌──────────┐     ┌───────────┐     ┌──────────────┐
 * │ setup.py │ ──→ │ Blender   │ ──→ │ depth_maps/  │
 * │ (bpy)    │     │ CLI       │     │ normal_maps/ │
 * └──────────┘     └───────────┘     └──────────────┘
 *
 * @dependencies child_process(spawn), sharp, CAMERA_ANGLES
 * @author AI Video Factory
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CAMERA_ANGLES } from '../templates/blender-prompt';
import { logger } from '../../common/logger';

// ─── 상수 ────────────────────────────────────────────────

const BLENDER_CMD = process.env.BLENDER_PATH ?? 'blender';
const UPLOADS_BASE = path.resolve('uploads/locations');
const EXPECTED_RESOLUTION = 1024;
const RENDER_TIMEOUT_MS = 300_000; // 5 minutes

// ─── 공개 타입 ───────────────────────────────────────────

export interface RenderResult {
  readonly depthMaps: string[];
  readonly normalMaps: string[];
  readonly cameraCount: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly depthCount: number;
  readonly normalCount: number;
}

// ─── 내부 헬퍼 ──────────────────────────────────────────

const readPngs = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => path.join(dir, f))
        .sort()
    : [];

function getLocationDirs(locationId: string): { depthDir: string; normalDir: string } {
  const locDir = path.join(UPLOADS_BASE, locationId);
  return {
    depthDir: path.join(locDir, 'depth_maps'),
    normalDir: path.join(locDir, 'normal_maps'),
  };
}

async function checkResolution(filePath: string): Promise<string | null> {
  try {
    const meta = await sharp(filePath).metadata();
    if (meta.width !== EXPECTED_RESOLUTION || meta.height !== EXPECTED_RESOLUTION) {
      return `${path.basename(filePath)}: 해상도 ${meta.width}x${meta.height} (기대값: ${EXPECTED_RESOLUTION}x${EXPECTED_RESOLUTION})`;
    }
    return null;
  } catch (err) {
    return `${path.basename(filePath)}: 이미지 메타데이터 읽기 실패 — ${String(err)}`;
  }
}

// ─── 공개 API ────────────────────────────────────────────

/**
 * Blender CLI를 실행하여 depth/normal map을 렌더링한다.
 *
 * @param locationId 장소 ID (출력 경로 결정에 사용)
 * @param scriptPath bpy 스크립트 절대 경로 (setup.py)
 * @returns 생성된 depth/normal map 경로 목록
 */
export async function renderMaps(locationId: string, scriptPath: string): Promise<RenderResult> {
  logger.info('블렌더 렌더링 시작', { locationId, scriptPath });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(BLENDER_CMD, ['--background', '--python', scriptPath], {
      cwd: path.dirname(scriptPath),
      timeout: RENDER_TIMEOUT_MS,
    });

    const stderrChunks: Buffer[] = [];

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      logger.debug('blender stdout', { line: chunk.toString().trim() });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info('블렌더 렌더링 완료', { locationId, exitCode: code });
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString();
        logger.error('블렌더 렌더링 실패', { locationId, exitCode: code, stderr });
        reject(new Error(`Blender 종료 코드 ${code}. stderr: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      logger.error('블렌더 프로세스 오류', { locationId, error: String(err) });
      reject(new Error(`Blender 프로세스 실행 실패: ${err.message}`));
    });
  });

  const { depthDir, normalDir } = getLocationDirs(locationId);
  const depthMaps = readPngs(depthDir);
  const normalMaps = readPngs(normalDir);

  logger.info('렌더링 결과 수집', {
    locationId,
    depthCount: depthMaps.length,
    normalCount: normalMaps.length,
  });

  return {
    depthMaps,
    normalMaps,
    cameraCount: CAMERA_ANGLES.length,
  };
}

/**
 * 렌더링 결과를 검증한다: 파일 수, 해상도(1024x1024).
 *
 * @param locationId 장소 ID
 * @returns 유효성 검증 결과 (오류 목록 포함)
 */
export async function validateResults(locationId: string): Promise<ValidationResult> {
  logger.info('렌더링 결과 검증 시작', { locationId });

  const { depthDir, normalDir } = getLocationDirs(locationId);
  const depthMaps = readPngs(depthDir);
  const normalMaps = readPngs(normalDir);
  const expected = CAMERA_ANGLES.length;
  const errors: string[] = [];

  // 파일 수 검증
  if (depthMaps.length !== expected) {
    errors.push(`depth_maps 파일 수 불일치: ${depthMaps.length}개 (기대값: ${expected}개)`);
  }
  if (normalMaps.length !== expected) {
    errors.push(`normal_maps 파일 수 불일치: ${normalMaps.length}개 (기대값: ${expected}개)`);
  }

  // 해상도 검증 (depth maps만 샘플링)
  const resolutionErrors = await Promise.all(depthMaps.map(checkResolution));
  for (const err of resolutionErrors) {
    if (err !== null) errors.push(err);
  }

  const valid = errors.length === 0;
  logger.info('렌더링 결과 검증 완료', {
    locationId,
    valid,
    errorCount: errors.length,
    depthCount: depthMaps.length,
    normalCount: normalMaps.length,
  });

  return {
    valid,
    errors,
    depthCount: depthMaps.length,
    normalCount: normalMaps.length,
  };
}

/**
 * 기존 depth/normal map 경로를 정렬된 목록으로 반환한다.
 *
 * @param locationId 장소 ID
 * @returns depth/normal map 파일 경로 목록
 */
export function getMapPaths(locationId: string): { depthMaps: string[]; normalMaps: string[] } {
  const { depthDir, normalDir } = getLocationDirs(locationId);
  return {
    depthMaps: readPngs(depthDir),
    normalMaps: readPngs(normalDir),
  };
}
