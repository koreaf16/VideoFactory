/**
 * @module 이미지 유틸리티
 * @description sharp를 사용한 이미지 리사이즈, 썸네일 생성,
 *              크기 조회 등 이미지 처리 공통 유틸리티.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────┐
 * │ 원본 이미지  │ ──→ │ image-utils  │ ──→ │ 처리된   │
 * │ (Buffer)     │     │ (sharp)      │     │ Buffer   │
 * └──────────────┘     └──────────────┘     └──────────┘
 *
 * @dependencies sharp
 * @author AI Video Factory
 */

import sharp from 'sharp';
import { logger } from '../logger';

const DEFAULT_THUMBNAIL_SIZE = 256;

/**
 * 이미지 버퍼를 지정된 크기로 리사이즈하여 JPEG 썸네일을 생성한다.
 * 비율을 유지하면서 지정된 크기에 맞춘다 (fit: inside).
 *
 * @param imageBuffer - 원본 이미지 Buffer
 * @param size - 최대 가로/세로 크기 (기본값 256)
 * @returns JPEG 포맷의 리사이즈된 이미지 Buffer
 */
export async function createThumbnail(
  imageBuffer: Buffer,
  size: number = DEFAULT_THUMBNAIL_SIZE
): Promise<Buffer> {
  try {
    const thumbnail = await sharp(imageBuffer)
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    logger.debug('썸네일 생성 완료', {
      originalSize: imageBuffer.length,
      thumbnailSize: thumbnail.length,
      maxDimension: size,
    });

    return thumbnail;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('썸네일 생성 실패', { error: message, size });
    throw error;
  }
}

/**
 * 이미지 버퍼에서 가로/세로 크기를 조회한다.
 *
 * @param imageBuffer - 이미지 Buffer
 * @returns width, height 객체
 */
export async function getImageDimensions(
  imageBuffer: Buffer
): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(imageBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('이미지 크기 정보를 가져올 수 없습니다.');
    }

    const dimensions = {
      width: metadata.width,
      height: metadata.height,
    };

    logger.debug('이미지 크기 조회 완료', dimensions);

    return dimensions;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('이미지 크기 조회 실패', { error: message });
    throw error;
  }
}
