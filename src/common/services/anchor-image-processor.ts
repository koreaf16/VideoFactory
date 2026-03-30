/**
 * @module 앵커 이미지 개별 처리
 * @description 1개 앵커 이미지 생성 → 품질 평가 → DB 저장
 *
 * ┌─────────────────┐     ┌──────────────┐     ┌───────────┐     ┌─────────┐
 * │ ComfyUI 생성    │ ──→ │ 품질 평가    │ ──→ │ 얼굴추출  │ ──→ │ DB저장  │
 * │ (이미지)        │     │ (Python API) │     │ (벡터)    │     │ (Oracle)│
 * └─────────────────┘     └──────────────┘     └───────────┘     └─────────┘
 *
 * @dependencies comfyui-client, quality-api, embedding-api, file-utils, image-utils
 * @author AI Video Factory
 */

import path from 'path';
import { comfyuiClient } from '../../comfyui/client';
import {
  buildKontextAnchorWorkflow,
  buildPulidAnchorWorkflow,
} from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { scoreImage } from '../../python-api/endpoints/quality-api';
import { getFaceBoundingBox } from '../../python-api/endpoints/embedding-api';
import { getConnection } from '../../db/connection';
import { insertAnchor } from '../../db/queries/anchor-image-queries';
import { writeFileBuffer, readFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import type {
  AnchorGenerationJob,
  AnchorEntityType,
  PulidModeOptions,
} from '../../common/types/anchor-image.types';

/**
 * 품질 점수에 따라 등급을 부여한다.
 *
 * @param score - 0~1 범위의 품질 점수
 * @returns 등급 문자열 ('S', 'A', 'B', 'C')
 */
function assignGrade(score: number): string {
  if (score >= 0.9) return 'S';
  if (score >= 0.8) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}

/**
 * ComfyUI에서 이미지를 생성하고 로컬 디렉토리에 저장한다.
 * 썸네일도 함께 생성된다.
 *
 * @internal
 */
async function generateAndSaveImage(
  entityType: AnchorEntityType,
  entityId: string,
  outDir: string,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<string> {
  const seed = Math.floor(Math.random() * 999999999);

  // 프롬프트 빌드 (간단하게 customPrompt 사용, 또는 엔티티 타입별 기본값)
  const prompt = customPrompt || `${entityType} ${entityId}`;

  await comfyuiClient.connect();

  let workflow;
  if (pulidOpts) {
    const refName = await comfyuiClient.uploadImage(pulidOpts.referenceImagePath);
    workflow = buildPulidAnchorWorkflow({
      referenceImageName: refName,
      prompt,
      seed,
      pulidStrength: pulidOpts.pulidStrength,
      guidance: pulidOpts.guidance,
      filenamePrefix: `${entityType}_${entityId}_${seed}`,
    });
  } else {
    workflow = buildKontextAnchorWorkflow({
      prompt,
      seed,
      filenamePrefix: `${entityType}_${entityId}_${seed}`,
    });
  }

  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const { images } = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${entityType}_${entityId}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  return imagePath;
}

/**
 * 1개의 앵커 이미지를 생성, 평가, 저장한다.
 * job.anchors 배열에 결과를 추가하고 job.completed를 증가시킨다.
 *
 * @param job - 현재 배치 작업 정보 (진행상황 업데이트용)
 * @param entityType - 엔티티 타입 ('character', 'location', 'npc')
 * @param outDir - 이미지 저장 디렉토리
 * @param customPrompt - 커스텀 프롬프트 (선택사항)
 * @param pulidOpts - PuLID 모드 옵션 (선택사항)
 */
export async function processOneAnchor(
  job: AnchorGenerationJob,
  entityType: AnchorEntityType,
  outDir: string,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<void> {
  const seed = Math.floor(Math.random() * 999999999);
  const prompt = customPrompt || `${entityType} ${job.entityId}`;

  const imagePath = await generateAndSaveImage(
    entityType,
    job.entityId,
    outDir,
    customPrompt,
    pulidOpts,
  );

  job.status = 'scoring';
  let faceBbox: string | null = null;

  try {
    const [scoreResult, bboxResult] = await Promise.all<
      { success: boolean; data?: { score: number } } | { success: boolean; data?: unknown }
    >([
      scoreImage(imagePath),
      entityType === 'character'
        ? getFaceBoundingBox(imagePath)
        : Promise.resolve({ success: false } as const),
    ]);

    let qualityScore: number | null = null;
    let grade: string | null = null;

    if (scoreResult.success && scoreResult.data !== undefined) {
      qualityScore = scoreResult.data.score;
      grade = assignGrade(scoreResult.data.score);
    }

    if (bboxResult.success && bboxResult.data !== undefined) {
      faceBbox = JSON.stringify(bboxResult.data);
      logger.debug('얼굴 좌표 추출 완료', { jobId: job.jobId, bbox: faceBbox });
    }

    // DB 저장
    const imageBuffer = await readFileBuffer(imagePath);
    const thumbBuffer = await createThumbnail(imageBuffer);

    const conn = await getConnection();
    try {
      const anchorId = await insertAnchor(conn, {
        entityType,
        entityId: job.entityId,
        imageBlob: imageBuffer,
        thumbnailBlob: thumbBuffer,
        imagePath,
        jobId: job.jobId,
        promptText: prompt,
        seed,
        qualityScore: qualityScore ?? null,
        grade: grade ?? null,
        faceBbox,
      });

      job.anchors.push({
        anchorId,
        imageUrl: `/api/images/anchors/${anchorId}`,
        thumbnailUrl: `/api/images/anchors/${anchorId}?thumbnail=true`,
        prompt,
        seed,
        qualityScore: qualityScore ?? undefined,
        grade: grade ?? undefined,
      });
    } finally {
      await conn.close();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('AI 분석 일부 실패 (건너뜀)', { jobId: job.jobId, error: msg });
  }

  job.completed += 1;
  job.status = 'generating';
  logger.debug('앵커 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
  });
}
