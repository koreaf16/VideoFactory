/**
 * @module LoRA 캡셔닝 실행기
 * @description Florence-2 기반 자동 캡셔닝 루프 로직
 *
 * ★ 얼굴 LoRA 캡셔닝 규칙:
 *   - 이 LoRA는 얼굴 LoRA이다. 데이터셋은 얼굴 클로즈업 + 상반신만 포함.
 *   - 전신/뒷모습 이미지는 데이터셋에 포함하지 않는다.
 *   - 전신 프롬프트 사용 시 몸/의상/체형은 베이스 모델이 생성하며,
 *     LoRA는 얼굴 일관성만 담당한다.
 *   - 캡션 구조: [trigger_word], [얼굴/표정/각도 중심 캡션]
 *   - Florence-2 자동 캡션에서 의상/체형 서술이 과도하면 수동 보정 권장.
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
import type { ComfyUIResult } from '../../comfyui/types/comfyui.types';
import { restoreImageFromBlob } from '../../common/utils/image-utils';

function extractCaptionFromResult(result: ComfyUIResult): string {
  return result.texts[0] || '';
}

async function captionOneImage(img: DatasetImageRow, triggerWord: string): Promise<string> {
  await comfyuiClient.connect();
  const tempPath = await restoreImageFromBlob(img.IMAGE_BLOB, `caption_${img.DATASET_IMAGE_ID}`);
  const uploadedName = await comfyuiClient.uploadImage(tempPath);
  const workflow = buildCaptionWorkflow({ imageName: uploadedName });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const result = await comfyuiClient.waitForResult(promptId, 300_000); // 5분으로 타임아웃 연장
  const rawCaption = extractCaptionFromResult(result);
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
    } satisfies CaptionProgressEvent);

    try {
      events.emit(`caption:${datasetId}`, {
        datasetId,
        current,
        total,
        status: 'captioning',
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
