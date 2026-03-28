/**
 * @module LoRA 캡셔닝 실행기
 * @description Florence-2 기반 자동 캡셔닝 루프 로직
 *
 * @dependencies comfyui, db, logger
 * @author AI Video Factory
 */

import { comfyuiClient } from '../../comfyui/client';
import { buildCaptionWorkflow } from '../../comfyui/workflows/caption-workflows';
import { getConnection } from '../../db/connection';
import { UPDATE_DATASET_STATUS, UPDATE_CAPTION_AUTO } from '../../db/queries/lora-queries';
import type { DatasetImageRow } from '../../db/queries/lora-queries';
import type { CaptionProgressEvent } from './lora-dataset';
import { logger } from '../../common/logger';
import { EventEmitter } from 'events';

function extractCaptionFromResult(results: unknown[]): string {
  return String(results[0] ?? '');
}

async function captionOneImage(img: DatasetImageRow, triggerWord: string): Promise<string> {
  await comfyuiClient.connect();
  const uploadedName = await comfyuiClient.uploadImage(img.IMAGE_PATH);
  const workflow = buildCaptionWorkflow({ imageName: uploadedName });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const results = await comfyuiClient.waitForResult(promptId, 60_000);
  const rawCaption = extractCaptionFromResult(results);
  return triggerWord ? `${triggerWord}, ${rawCaption}` : rawCaption;
}

/** 이미지 배열에 대해 Florence-2 캡셔닝을 실행한다. */
export async function runCaptioningLoop(
  datasetId: string,
  triggerWord: string,
  images: DatasetImageRow[],
  events: EventEmitter,
): Promise<void> {
  const total = images.length;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const current = i + 1;

    events.emit(`caption:${datasetId}`, {
      datasetId,
      current,
      total,
      status: 'uploading',
      imagePath: img.IMAGE_PATH,
    } satisfies CaptionProgressEvent);

    try {
      events.emit(`caption:${datasetId}`, {
        datasetId,
        current,
        total,
        status: 'captioning',
        imagePath: img.IMAGE_PATH,
      } satisfies CaptionProgressEvent);

      const caption = await captionOneImage(img, triggerWord);
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
      logger.debug('이미지 캡셔닝 완료', { datasetId, progress: `${current}/${total}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('이미지 캡셔닝 실패', { datasetId, imageId: img.DATASET_IMAGE_ID, error: msg });
    }
  }

  const doneConn = await getConnection();
  try {
    await doneConn.execute(UPDATE_DATASET_STATUS, { datasetId, status: 'ready' });
    await doneConn.commit();
  } finally {
    await doneConn.close();
  }

  events.emit(`caption:${datasetId}`, {
    datasetId,
    current: total,
    total,
    status: 'ready',
  } satisfies CaptionProgressEvent);

  logger.info('데이터셋 캡셔닝 완료', { datasetId, total });
}
