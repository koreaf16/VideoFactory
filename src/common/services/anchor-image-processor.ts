/**
 * @module 앵커 이미지 개별 처리
 * @description 1개 앵커 이미지 생성 → 품질 평가 → DB 저장 (BLOB만)
 *
 * ┌─────────────────┐     ┌──────────────┐     ┌───────────┐     ┌─────────┐
 * │ ComfyUI 생성    │ ──→ │ 품질 평가    │ ──→ │ 얼굴추출  │ ──→ │ DB저장  │
 * │ (Buffer)        │     │ (Python API) │     │ (벡터)    │     │ (Oracle)│
 * └─────────────────┘     └──────────────┘     └───────────┘     └─────────┘
 *
 * @dependencies comfyui-client, quality-api, embedding-api, image-utils
 * @author AI Video Factory
 */

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
 * ComfyUI에서 이미지를 생성하고 Buffer로만 반환한다.
 * 썸네일도 함께 생성되어 반환된다.
 * (디스크 저장 없음)
 *
 * @internal
 * @returns [imageBuffer, thumbnailBuffer, seed, prompt]
 */
async function generateAndSaveImage(
  entityType: AnchorEntityType,
  entityId: string,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<[Buffer, Buffer, number, string]> {
  const seed = Math.floor(Math.random() * 999999999);
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
  const thumbnail = await createThumbnail(imageBuffer);

  return [imageBuffer, thumbnail, seed, prompt];
}

/**
 * 1개의 앵커 이미지를 생성, 평가, 저장한다 (BLOB만).
 * job.anchors 배열에 결과를 추가하고 job.completed를 증가시킨다.
 *
 * @param job - 현재 배치 작업 정보 (진행상황 업데이트용)
 * @param entityType - 엔티티 타입 ('character', 'location', 'npc')
 * @param customPrompt - 커스텀 프롬프트 (선택사항)
 * @param pulidOpts - PuLID 모드 옵션 (선택사항)
 */
export async function processOneAnchor(
  job: AnchorGenerationJob,
  entityType: AnchorEntityType,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<void> {
  // 1. 이미지 생성 (ComfyUI) → Buffer로만 반환 (디스크 저장 없음)
  const [imageBuffer, thumbnailBuffer, seed, prompt] = await generateAndSaveImage(
    entityType,
    job.entityId,
    customPrompt,
    pulidOpts,
  );

  job.status = 'scoring';
  let qualityScore: number | null = null;
  let grade: string | null = null;
  let faceBbox: string | null = null;

  try {
    // 2. 품질 평가 (Buffer 기반)
    const scorePromise = scoreImage(imageBuffer as unknown as string);
    const bboxPromise =
      entityType === 'character'
        ? getFaceBoundingBox(imageBuffer as unknown as string)
        : Promise.resolve(null);

    const [scoreResult, bboxResult] = await Promise.all([scorePromise, bboxPromise]);

    if (scoreResult?.success && scoreResult?.data) {
      qualityScore = (scoreResult.data as { score: number }).score;
      grade = assignGrade(qualityScore);
    }

    if (entityType === 'character' && bboxResult?.success && bboxResult?.data) {
      faceBbox = JSON.stringify(bboxResult.data);
      logger.debug('얼굴 좌표 추출 완료', { jobId: job.jobId, bbox: faceBbox });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('AI 분석 일부 실패 (건너뜀)', { jobId: job.jobId, error: msg });
  }

  // 3. DB 저장 (BLOB만, 파일 경로 없음)
  const conn = await getConnection();
  try {
    const anchorId = await insertAnchor(conn, {
      entityType,
      entityId: job.entityId,
      imageBlob: imageBuffer,
      thumbnailBlob: thumbnailBuffer,
      jobId: job.jobId,
      promptText: prompt,
      seed,
      qualityScore,
      grade,
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

  job.completed += 1;
  job.status = 'generating';
  logger.debug('앵커 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
  });
}
