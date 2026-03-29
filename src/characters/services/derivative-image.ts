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

import path from 'path';
import oracledb from 'oracledb';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import {
  DERIVATIVE_PRESETS,
  type DerivativePreset,
  type DerivativeResult,
  type DerivativeJob,
} from './derivative-presets';
import { filterAndDeleteDissimilar } from './derivative-filter';

// ─── 이미지 생성 (1장) ──────────────────────────────────

export async function generateOneImage(
  job: DerivativeJob,
  preset: DerivativePreset,
  basePrompt: string,
  outDir: string,
  emitProgress: (job: DerivativeJob) => void,
): Promise<DerivativeResult | null> {
  const seed = Math.floor(Math.random() * 999999999);
  // Kontext ReferenceLatent가 앵커 이미지에서 identity를 보존하므로
  // 편집 프롬프트에 외모 토큰을 추가하면 오히려 편집 지시가 희석된다.
  const editPrompt = preset.promptSuffix;

  job.currentStep = `${preset.label} 생성 중... (${job.generated + 1}/${job.total})`;
  emitProgress(job);

  await comfyuiClient.connect();
  const anchorName = await comfyuiClient.uploadImage(job.anchorPath);
  const workflow = buildKontextEditWorkflow({
    anchorImageName: anchorName,
    editPrompt,
    seed,
    filenamePrefix: `${job.charId}_${preset.label}_${seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  // Flux Kontext ReferenceLatent는 레이턴트 크기가 2배 → RTX 3090 기준 최대 5분
  const images = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI 편집 결과 없음');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${job.charId}_${preset.label}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);

  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  const refId = await saveDerivativeToDb(job.charId, imagePath, preset.label);
  job.generated += 1;

  return {
    refId,
    imagePath,
    label: preset.label,
    prompt: editPrompt,
    seed,
    skipSimilarity: preset.skipSimilarity,
  };
}

async function saveDerivativeToDb(
  charId: string,
  imagePath: string,
  poseTag: string,
): Promise<number | undefined> {
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `INSERT INTO char_ref_images (char_id, image_path, pose_tag)
       VALUES (:charId, :imagePath, :poseTag)
       RETURNING ref_id INTO :refId`,
      { charId, imagePath, poseTag, refId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
      { autoCommit: true },
    );
    // oracledb outBinds 타입이 any라서 타입 캐스팅 필요
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
  await ensureDir(outDir);
  job.status = 'generating';

  for (const preset of DERIVATIVE_PRESETS) {
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

  const allGenerated = [...job.results];
  const kept = await filterAndDeleteDissimilar(job, allGenerated, emitProgress);
  job.results = kept;
  job.status = 'completed';
  job.currentStep = `완료! ${kept.length}/${allGenerated.length}장 유사 통과 (${job.deleted}장 삭제)`;
  emitProgress(job);
  logger.info('파생 생성 완료', {
    jobId: job.jobId,
    generated: job.generated,
    kept: kept.length,
    deleted: job.deleted,
  });
}
