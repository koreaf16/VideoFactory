/**
 * @module 파생 이미지 생성 내부 헬퍼
 * @description ComfyUI 호출, 파일 저장, DB 저장, 유사도 필터링 루프의
 *              내부 구현 함수들을 담당한다.
 *
 * ┌──────────┐     ┌──────────────┐     ┌──────────┐
 * │ preset   │ ──→ │ generateOne  │ ──→ │ 파일 저장 │
 * │ + anchor │     │ Image        │     │ DB 저장  │
 * └──────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies comfyui, derivative-presets, derivative-filter, db
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import oracledb from 'oracledb';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail, restoreImageFromBlob } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import { getFaceBoundingBox } from '../../python-api/endpoints/embedding-api';
import {
  DERIVATIVE_PRESETS,
  type DerivativePreset,
  type DerivativeResult,
  type DerivativeJob,
} from './derivative-presets';
import { filterAndDeleteDissimilar } from './derivative-filter';
import {
  LIST_CUSTOM_REF_IMAGES,
  DELETE_NON_CUSTOM_REF_IMAGES,
} from '../../db/queries/character-queries';

// ─── 이미지 생성 (1장) ──────────────────────────────────

export async function generateOneImage(
  job: DerivativeJob,
  preset: DerivativePreset,
  _basePrompt: string,
  outDir: string,
  emitProgress: (job: DerivativeJob) => void,
  isCustom: boolean = false,
): Promise<DerivativeResult | null> {
  const seed = Math.floor(Math.random() * 999999999);
  const editPrompt = preset.promptSuffix;

  job.currentStep = `${preset.label} 생성 중... (${job.generated + 1}/${job.total})`;
  emitProgress(job);

  // 0. 앵커 이미지 복원 (ComfyUI 업로드용)
  const tempAnchorPath = await restoreImageFromBlob(job.anchorBlob, `anchor_${job.charId}`);

  await comfyuiClient.connect();
  const anchorName = await comfyuiClient.uploadImage(tempAnchorPath);
  const workflow = buildKontextEditWorkflow({
    anchorImageName: anchorName,
    editPrompt,
    seed,
    filenamePrefix: `${job.charId}_${preset.label}_${seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const { images } = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI 편집 결과 없음');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  const thumbnail = await createThumbnail(imageBuffer);
  
  // 파일 저장
  await ensureDir(outDir);
  const filename = `${job.charId}_${preset.label}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  // 1. 얼굴 좌표 추출
  let faceBbox: any = null;
  try {
    const bboxResult = await getFaceBoundingBox(imagePath);
    if (bboxResult.success && bboxResult.data) {
      faceBbox = bboxResult.data;
      logger.debug('파생 이미지 얼굴 좌표 추출 완료', { charId: job.charId, bbox: faceBbox });
    }
  } catch (err: unknown) {
    logger.warn('파생 이미지 얼굴 좌표 추출 실패 (건너뜀)', { charId: job.charId, error: String(err) });
  }

  // 2. DB 저장 (BLOB, BBox 포함)
  const refId = await saveDerivativeToDb(
    job.charId,
    imageBuffer,
    thumbnail,
    preset.label,
    faceBbox,
    isCustom
  );
  
  job.generated += 1;

  return {
    refId,
    imagePath,
    imageBlob: imageBuffer,
    label: preset.label,
    prompt: editPrompt,
    seed,
    skipSimilarity: preset.skipSimilarity,
    isCustom,
  };
}

async function saveDerivativeToDb(
  charId: string,
  imageBlob: Buffer,
  thumbnailBlob: Buffer,
  poseTag: string,
  faceBbox: any = null,
  isCustom: boolean = false,
): Promise<number | undefined> {
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `INSERT INTO char_ref_images (char_id, image_blob, thumbnail_blob, pose_tag, face_bbox, is_custom)
       VALUES (:charId, :imageBlob, :thumbnailBlob, :poseTag, :faceBbox, :isCustom)
       RETURNING ref_id INTO :refId`,
      {
        charId,
        imageBlob,
        thumbnailBlob,
        poseTag,
        faceBbox: faceBbox ? JSON.stringify(faceBbox) : null,
        isCustom: isCustom ? 1 : 0,
        refId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const outBinds = result.outBinds as unknown as { refId: number[] };
    return outBinds.refId[0];
  } finally {
    await conn.close();
  }
}

// ─── 메인 루프 ──────────────────────────────────────────

export async function processDerivativeLoop(
  job: DerivativeJob,
  basePrompt: string,
  outDir: string,
  emitProgress: (job: DerivativeJob) => void,
): Promise<void> {
  const customPoseTags = new Set<string>();
  const conn = await getConnection();
  try {
    const customRows = await conn.execute<{ REF_ID: number; IMAGE_BLOB: Buffer; POSE_TAG: string }>(
      LIST_CUSTOM_REF_IMAGES,
      { charId: job.charId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    for (const row of customRows.rows ?? []) {
      customPoseTags.add(row.POSE_TAG);
      job.results.push({
        refId: row.REF_ID,
        imageBlob: row.IMAGE_BLOB,
        label: row.POSE_TAG,
        prompt: '(커스텀 보존)',
        seed: 0,
        isCustom: true,
      });
    }

    await conn.execute(DELETE_NON_CUSTOM_REF_IMAGES, { charId: job.charId }, { autoCommit: true });

    if (customPoseTags.size > 0) {
      logger.info('커스텀 이미지 보존', {
        charId: job.charId,
        preserved: [...customPoseTags],
      });
    }
    logger.info('비커스텀 파생 이미지 DB 정리 완료', { charId: job.charId });
  } finally {
    await conn.close();
  }

  const presetsToGenerate = DERIVATIVE_PRESETS.filter((p) => !customPoseTags.has(p.label));
  job.total = DERIVATIVE_PRESETS.length;
  job.completed = DERIVATIVE_PRESETS.length - presetsToGenerate.length;
  job.status = 'generating';

  for (const preset of presetsToGenerate) {
    if (job.shouldStop) {
      job.status = 'stopped';
      job.currentStep = `중단됨 — ${job.completed}/${job.total} 포즈 완료`;
      emitProgress(job);
      return;
    }
    try {
      const result = await generateOneImage(job, preset, basePrompt, outDir, emitProgress);
      if (result) job.results.push(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('이미지 생성 실패', { label: preset.label, error: msg });
    }
    job.completed += 1;
    emitProgress(job);
  }

  const customKept = job.results.filter((r) => r.isCustom);
  const newlyGenerated = job.results.filter((r) => !r.isCustom);
  const kept = await filterAndDeleteDissimilar(job, newlyGenerated, emitProgress);
  job.results = [...customKept, ...kept];
  const totalKept = customKept.length + kept.length;
  job.status = 'completed';
  job.currentStep = `완료! ${totalKept}장 (커스텀 ${customKept.length} + 신규 ${kept.length}/${newlyGenerated.length})`;
  emitProgress(job);
  logger.info('파생 생성 완료 (DB 전용)', {
    jobId: job.jobId,
    generated: job.generated,
    kept: kept.length,
    deleted: job.deleted,
  });
}
