/**
 * @module 장소 앵글 변형 생성 서비스
 * @description 앵커 이미지 + promptBase + 앵글 프리셋을 결합하여 ControlNet + IP-Adapter로 다양한 앵글 변형을 생성한다.
 *
 * @dependencies comfyui, location-presets, blender-renderer, db
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';
import { comfyuiClient } from '../../comfyui/client';
import { buildControlNetDerivativeWorkflow } from '../../comfyui/workflows/controlnet-workflows';
import { getMapPaths } from './blender-renderer';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { generateJobId } from '../../common/utils/time-utils';
import { logger } from '../../common/logger';
import {
  LOCATION_PRESETS,
  type LocationPreset,
  type LocationDerivResult,
  type LocationDerivJob,
} from './location-presets';

export type { LocationDerivResult, LocationDerivJob };

export const locDerivEvents = new EventEmitter();
locDerivEvents.setMaxListeners(50);

const activeJobs: Map<string, LocationDerivJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/locations');

function emitProgress(job: LocationDerivJob): void {
  locDerivEvents.emit(`job:${job.jobId}`, {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    completed: job.completed,
    currentStep: job.currentStep,
    results: job.results,
  });
}

async function generateOneAngle(
  job: LocationDerivJob,
  preset: LocationPreset,
  outDir: string,
): Promise<LocationDerivResult | null> {
  const seed = Math.floor(Math.random() * 999999999);
  job.currentStep = `${preset.label} 생성 중... (${job.completed + 1}/${job.total})`;
  emitProgress(job);

  // depth/normal map을 카메라 ID로 조회
  const { depthMaps, normalMaps } = getMapPaths(job.locationId);
  const depthFile = depthMaps.find((f) => path.basename(f, '.png') === preset.cameraId);
  const normalFile = normalMaps.find((f) => path.basename(f, '.png') === preset.cameraId);
  if (!depthFile) throw new Error(`depth map 없음: ${preset.cameraId}`);

  await comfyuiClient.connect();
  const depthName = await comfyuiClient.uploadImage(depthFile);
  const normalName = normalFile ? await comfyuiClient.uploadImage(normalFile) : depthName;
  const anchorName = await comfyuiClient.uploadImage(job.anchorPath); // style anchor

  // ControlNet + IP-Adapter: depth/normal map으로 공간 구조 유지, 스타일 앵커로 색감/분위기 유지
  const workflow = buildControlNetDerivativeWorkflow({
    depthMapName: depthName,
    normalMapName: normalName,
    styleAnchorName: anchorName,
    prompt: job.promptBase,
    seed,
    filenamePrefix: `${job.locationId}_${preset.angle}_${seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const { images } = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI 결과 없음');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const resp = await fetch(imageUrl);
  const buf = Buffer.from(await resp.arrayBuffer());
  const filename = `${job.locationId}_${preset.angle}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, buf);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), await createThumbnail(buf));

  const conn = await getConnection();
  let refId: number | undefined;
  try {
    const r = await conn.execute(
      `INSERT INTO location_ref_images (location_id, image_path, angle, approved)
       VALUES (:locationId, :imagePath, :angle, 1)
       RETURNING ref_id INTO :refId`,
      {
        locationId: job.locationId,
        imagePath,
        angle: preset.angle,
        refId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const out = r.outBinds as unknown as { refId: number[] };
    refId = out.refId[0];
  } finally {
    await conn.close();
  }

  return {
    refId,
    imagePath,
    label: preset.label,
    angle: preset.angle,
    prompt: preset.regenHint,
    seed,
  };
}

export function startLocDerivativeGeneration(
  locationId: string,
  anchorPath: string,
  promptBase?: string,
): string {
  if (!promptBase) {
    throw new Error('장소 앵글 변형 생성에는 promptBase가 필요합니다.');
  }
  const jobId = generateJobId('locderiv');
  const job: LocationDerivJob = {
    jobId,
    locationId,
    anchorPath,
    promptBase,
    status: 'preparing',
    total: LOCATION_PRESETS.length,
    completed: 0,
    currentStep: '준비 중...',
    results: [],
  };
  activeJobs.set(jobId, job);
  logger.info('장소 변형 생성 시작 (ControlNet + IP-Adapter)', { jobId, locationId });

  const outDir = path.join(EXPORTS_BASE, locationId, jobId);
  processLoop(job, LOCATION_PRESETS, outDir).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('장소 변형 생성 실패', { jobId, error: msg });
    job.status = 'failed';
    job.currentStep = `실패: ${msg}`;
    emitProgress(job);
  });

  return jobId;
}

export function getLocDerivJob(jobId: string): LocationDerivJob | undefined {
  return activeJobs.get(jobId);
}

export function stopLocDerivGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  return true;
}

async function processLoop(
  job: LocationDerivJob,
  presets: readonly LocationPreset[],
  outDir: string,
): Promise<void> {
  await ensureDir(outDir);

  // 이전 ref_images 정리
  const conn = await getConnection();
  try {
    await conn.execute(
      'DELETE FROM location_ref_images WHERE location_id = :lid',
      { lid: job.locationId },
      { autoCommit: true },
    );
  } finally {
    await conn.close();
  }

  // 이전 파일 정리 (앵커 이미지가 있는 디렉토리는 보존)
  const parentDir = path.join(EXPORTS_BASE, job.locationId);
  const anchorDir = path.basename(path.dirname(job.anchorPath));
  if (fs.existsSync(parentDir)) {
    for (const d of fs.readdirSync(parentDir).filter((x) => x !== job.jobId && x !== anchorDir)) {
      const fp = path.join(parentDir, d);
      if (fs.statSync(fp).isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
    }
  }

  job.status = 'generating';
  for (const preset of presets) {
    if (job.shouldStop) {
      job.status = 'stopped';
      job.currentStep = `중단됨 — ${job.completed}/${job.total}`;
      emitProgress(job);
      return;
    }
    try {
      const result = await generateOneAngle(job, preset, outDir);
      if (result) job.results.push(result);
    } catch (err: unknown) {
      logger.error('앵글 변형 실패', { label: preset.label, error: String(err) });
    }
    job.completed += 1;
    emitProgress(job);
  }
  job.status = 'completed';
  job.currentStep = `완료! ${job.results.length}/${job.total}장`;
  emitProgress(job);
}
