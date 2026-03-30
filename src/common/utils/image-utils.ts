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

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { logger } from '../logger';
import { ensureDir } from './file-utils';

const DEFAULT_THUMBNAIL_SIZE = 256;
const TEMP_IMAGE_DIR = path.resolve('exports/tmp');

/**
 * BLOB 데이터를 파일시스템에 임시 파일로 복원한다.
 * ComfyUI나 FFmpeg 처럼 물리 파일 경로가 필요한 경우 사용한다.
 *
 * @param blob - 이미지 Buffer
 * @param prefix - 파일명 접두어 (기본값 'tmp')
 * @returns 복원된 임시 파일의 절대 경로
 */
export async function restoreImageFromBlob(
  blob: Buffer,
  prefix: string = 'tmp'
): Promise<string> {
  try {
    await ensureDir(TEMP_IMAGE_DIR);
    
    // 파일 내용 기반 해시로 중복 생성 방지
    const hash = crypto.createHash('md5').update(blob).digest('hex');
    const filePath = path.join(TEMP_IMAGE_DIR, `${prefix}_${hash}.png`);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, blob);
      logger.debug('BLOB 복원 완료', { prefix, path: filePath, size: blob.length });
    }

    return filePath;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('BLOB 복원 실패', { error: message });
    throw error;
  }
}

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
