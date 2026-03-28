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
 * @dependencies comfyui, db, logger
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';
import { comfyuiClient } from '../../comfyui/client';
import { buildCaptionWorkflow } from '../../comfyui/workflows/caption-workflows';
import { getConnection } from '../../db/connection';
import {
  INSERT_DATASET,
  INSERT_DATASET_IMAGE,
  GET_DATASET,
  GET_DATASET_BY_CHAR,
  LIST_DATASET_IMAGES,
  UPDATE_DATASET_STATUS,
  UPDATE_CAPTION_AUTO,
  UPDATE_CAPTION_EDITED,
} from '../../db/queries/lora-queries';
import type { DatasetRow, DatasetImageRow } from '../../db/queries/lora-queries';
import { logger } from '../../common/logger';

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

// ─── 헬퍼 ──────────────────────────────────────────────

function extractCaptionFromResult(results: unknown[]): string {
  return String(results[0] ?? '');
}

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
      await conn.execute(INSERT_DATASET_IMAGE, {
        datasetImageId: randomUUID(),
        datasetId,
        sourceType,
        sourceId: imageId,
        imagePath: '',
        poseTag: null,
        approved: 1,
      });
    }

    await conn.commit();
    logger.info('데이터셋 생성 완료', { datasetId, charId, images: imageIds.length });
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
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      },
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
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      },
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
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      },
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
  const total = images.length;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const current = i + 1;

    datasetEvents.emit(`caption:${datasetId}`, {
      datasetId,
      current,
      total,
      status: 'uploading',
      imagePath: img.IMAGE_PATH,
    } satisfies CaptionProgressEvent);

    try {
      await comfyuiClient.connect();
      const uploadedName = await comfyuiClient.uploadImage(img.IMAGE_PATH);

      datasetEvents.emit(`caption:${datasetId}`, {
        datasetId,
        current,
        total,
        status: 'captioning',
        imagePath: img.IMAGE_PATH,
      } satisfies CaptionProgressEvent);

      const workflow = buildCaptionWorkflow({ imageName: uploadedName });
      const promptId = await comfyuiClient.submitWorkflow(workflow);
      const results = await comfyuiClient.waitForResult(promptId, 60_000);

      const rawCaption = extractCaptionFromResult(results);
      const caption = triggerWord ? `${triggerWord}, ${rawCaption}` : rawCaption;

      const imgConn = await getConnection();
      try {
        await imgConn.execute(UPDATE_CAPTION_AUTO, {
          datasetImageId: img.DATASET_IMAGE_ID,
          captionAuto: caption,
        });
        await imgConn.commit();
      } finally {
        await imgConn.close();
      }

      logger.debug('이미지 캡셔닝 완료', {
        datasetId,
        progress: `${current}/${total}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('이미지 캡셔닝 실패', {
        datasetId,
        imageId: img.DATASET_IMAGE_ID,
        error: msg,
      });
    }
  }

  const doneConn = await getConnection();
  try {
    await doneConn.execute(UPDATE_DATASET_STATUS, { datasetId, status: 'ready' });
    await doneConn.commit();
  } finally {
    await doneConn.close();
  }

  datasetEvents.emit(`caption:${datasetId}`, {
    datasetId,
    current: total,
    total,
    status: 'ready',
  } satisfies CaptionProgressEvent);

  logger.info('데이터셋 캡셔닝 완료', { datasetId, total });
}

// ─── 캡션 편집 ─────────────────────────────────────────

export async function updateCaption(datasetImageId: string, caption: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(UPDATE_CAPTION_EDITED, {
      datasetImageId,
      captionEdited: caption,
    });
    await conn.commit();
  } finally {
    await conn.close();
  }
}
