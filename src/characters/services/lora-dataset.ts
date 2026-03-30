/**
 * @module LoRA 데이터셋 서비스
 * @description 승인된 파생 이미지로부터 데이터셋을 구성하고,
 *              ComfyUI Florence-2를 이용한 자동 캡셔닝 및 캡션 편집을 처리한다.
 *
 * ┌───────────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
 * │ Approved Imgs │ ──→ │ Dataset  │ ──→ │ Florence-2   │ ──→ │ Caption  │
 * │ (파생/앵커)    │     │ (DB 생성) │     │ (ComfyUI)    │     │ (저장)   │
 * └───────────────┘     └──────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies comfyui, db, lora-caption, logger
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';
import { getConnection } from '../../db/connection';
import {
  INSERT_DATASET,
  INSERT_DATASET_IMAGE,
  GET_DATASET,
  GET_DATASET_BY_CHAR,
  LIST_DATASET_IMAGES,
  UPDATE_DATASET_STATUS,
  UPDATE_CAPTION_EDITED,
} from '../../db/queries/lora-queries';
import type { DatasetRow, DatasetImageRow } from '../../db/queries/lora-queries';
import { runCaptioningLoop } from './lora-caption';
import { logger } from '../../common/logger';
import { restoreImageFromBlob } from '../../common/utils/image-utils';
import { getFaceBoundingBox, getImageEmbedding } from '../../python-api/endpoints/embedding-api';

// ─── SSE 이벤트 ────────────────────────────────────────

export interface CaptionProgressEvent {
  datasetId: string;
  current: number;
  total: number;
  status: string;
  imagePath?: string;
}

export const datasetEvents = new EventEmitter();
datasetEvents.setMaxListeners(50);

// ─── 데이터셋 생성 ─────────────────────────────────────

export async function createDataset(
  charId: string,
  name: string,
  triggerWord: string,
  imageIds: string[],
  sourceType: string,
): Promise<string> {
  const datasetId = randomUUID();
  const conn = await getConnection();

  try {
    await conn.execute(INSERT_DATASET, {
      datasetId,
      charId,
      name,
      triggerWord,
      status: 'draft',
      imageCount: imageIds.length,
    });

    for (const imageId of imageIds) {
      let imageBlob: Buffer | null = null;
      let thumbnailBlob: Buffer | null = null;
      let poseTag: string | null = null;
      let existingBbox: any = null;

      if (sourceType === 'derivative') {
        const res = await conn.execute<{ IMAGE_BLOB: Buffer; THUMBNAIL_BLOB: Buffer; POSE_TAG: string | null; FACE_BBOX: string | null }>(
          `SELECT image_blob, thumbnail_blob, pose_tag, face_bbox FROM char_ref_images WHERE ref_id = :refId`,
          { refId: Number(imageId) },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (res.rows && res.rows[0]) {
          imageBlob = res.rows[0].IMAGE_BLOB;
          thumbnailBlob = res.rows[0].THUMBNAIL_BLOB;
          poseTag = res.rows[0].POSE_TAG;
          existingBbox = res.rows[0].FACE_BBOX ? JSON.parse(res.rows[0].FACE_BBOX) : null;
        }
      } else if (sourceType === 'candidate') {
        const res = await conn.execute<{ IMAGE_BLOB: Buffer; THUMBNAIL_BLOB: Buffer; FACE_BBOX: string | null }>(
          `SELECT image_blob, thumbnail_blob, face_bbox FROM char_candidates WHERE candidate_id = :cid`,
          { cid: Number(imageId) },
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (res.rows && res.rows[0]) {
          imageBlob = res.rows[0].IMAGE_BLOB;
          thumbnailBlob = res.rows[0].THUMBNAIL_BLOB;
          existingBbox = res.rows[0].FACE_BBOX ? JSON.parse(res.rows[0].FACE_BBOX) : null;
        }
      }

      if (!imageBlob) {
        logger.warn('이미지 소스를 찾을 수 없음', { sourceType, imageId });
        continue;
      }

      // AI 처리를 위해 임시 파일 복원
      const tempPath = await restoreImageFromBlob(imageBlob, `dataset_${datasetId}`);
      
      // 만약 기존 BBox가 없으면 새로 추출
      if (!existingBbox) {
        const bboxRes = await getFaceBoundingBox(tempPath);
        if (bboxRes.success) existingBbox = bboxRes.data;
      }

      // CLIP 임베딩 추출 (학습 전 품질 검증용)
      const embedRes = await getImageEmbedding(tempPath);
      const faceEmbedding = embedRes.success ? embedRes.data?.embedding : null;

      await conn.execute(INSERT_DATASET_IMAGE, {
        datasetImageId: randomUUID(),
        datasetId,
        sourceType,
        sourceId: imageId,
        imageBlob,
        thumbnailBlob: thumbnailBlob || imageBlob, // 썸네일 없으면 원본
        faceBbox: existingBbox ? JSON.stringify(existingBbox) : null,
        faceEmbedding: faceEmbedding, // VECTOR 타입
        poseTag,
        approved: 1,
      });
    }

    await conn.commit();
    logger.info('데이터셋 생성 완료 (BLOB 포함)', { datasetId, charId, images: imageIds.length });
    return datasetId;
  } catch (err: unknown) {
    await conn.rollback();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('데이터셋 생성 실패', { charId, error: msg });
    throw err;
  } finally {
    await conn.close();
  }
}

// ─── 데이터셋 조회 ─────────────────────────────────────

export async function getDataset(datasetId: string): Promise<DatasetRow | null> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<DatasetRow>(
      GET_DATASET,
      { datasetId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows?.[0] ?? null;
  } finally {
    await conn.close();
  }
}

export async function getDatasetByChar(charId: string): Promise<DatasetRow[]> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<DatasetRow>(
      GET_DATASET_BY_CHAR,
      { charId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  } finally {
    await conn.close();
  }
}

export async function listDatasetImages(datasetId: string): Promise<DatasetImageRow[]> {
  const conn = await getConnection();
  try {
    const result = await conn.execute<DatasetImageRow>(
      LIST_DATASET_IMAGES,
      { datasetId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  } finally {
    await conn.close();
  }
}

// ─── Florence-2 캡셔닝 ────────────────────────────────

export async function startCaptioning(datasetId: string, triggerWord: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_DATASET_STATUS, { datasetId, status: 'captioning' });
    await conn.commit();
  } finally {
    await conn.close();
  }

  const images = await listDatasetImages(datasetId);
  await runCaptioningLoop(datasetId, triggerWord, images, datasetEvents);
}

// ─── 캡션 편집 ─────────────────────────────────────────

export async function updateCaption(datasetImageId: string, caption: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_CAPTION_EDITED, { datasetImageId, captionEdited: caption });
    await conn.commit();
  } finally {
    await conn.close();
  }
}
