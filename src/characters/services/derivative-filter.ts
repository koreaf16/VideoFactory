/**
 * @module 파생 이미지 유사도 필터
 * @description 얼굴 유사도 비교 후 비유사 이미지를 삭제하는 필터 로직
 *
 * @dependencies python-api, db, logger
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { getConnection } from '../../db/connection';
import { compareFaces } from '../../python-api/endpoints/embedding-api';
import { logger } from '../../common/logger';
import {
  FACE_SIMILARITY_THRESHOLD,
  type DerivativeResult,
  type DerivativeJob,
} from './derivative-presets';

/** 비유사 이미지 파일 + DB 삭제 */
async function deleteDissimilarImages(
  job: DerivativeJob,
  toDelete: DerivativeResult[],
): Promise<void> {
  for (const result of toDelete) {
    try {
      if (fs.existsSync(result.imagePath)) fs.unlinkSync(result.imagePath);
      const thumbPath = path.join(
        path.dirname(result.imagePath),
        `thumb_${path.basename(result.imagePath)}`,
      );
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      if (result.refId) {
        const conn = await getConnection();
        try {
          await conn.execute(
            'DELETE FROM char_ref_images WHERE ref_id = :refId',
            { refId: result.refId },
            { autoCommit: true },
          );
        } finally {
          await conn.close();
        }
      }
      job.deleted += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('비유사 이미지 삭제 실패', { path: result.imagePath, error: msg });
    }
  }
}

/** 배치 결과에서 얼굴 유사도 필터링을 수행한다. */
export async function filterAndDeleteDissimilar(
  job: DerivativeJob,
  batchResults: DerivativeResult[],
  emitProgress: (job: DerivativeJob) => void,
): Promise<DerivativeResult[]> {
  if (batchResults.length === 0) return [];

  const toFilter = batchResults.filter((r) => !r.skipSimilarity);
  const skipped = batchResults.filter((r) => r.skipSimilarity);
  if (toFilter.length === 0) return batchResults;

  job.status = 'filtering';
  job.currentStep = `얼굴 유사도 분석 중... (${toFilter.length}장, ${skipped.length}장 스킵)`;
  emitProgress(job);

  let compareResult;
  try {
    compareResult = await compareFaces(
      job.anchorPath,
      toFilter.map((r) => r.imagePath),
      FACE_SIMILARITY_THRESHOLD,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('얼굴 비교 API 호출 실패', { error: msg });
    return batchResults;
  }

  const similarPaths = new Set(compareResult.results.filter((r) => r.similar).map((r) => r.path));
  const kept: DerivativeResult[] = [...skipped];
  const toDelete: DerivativeResult[] = [];

  for (const result of toFilter) {
    if (similarPaths.has(result.imagePath)) {
      result.distance = compareResult.results.find((r) => r.path === result.imagePath)?.distance;
      kept.push(result);
    } else {
      toDelete.push(result);
    }
  }

  await deleteDissimilarImages(job, toDelete);

  logger.info('유사도 필터링 완료', {
    jobId: job.jobId,
    batch: job.batch,
    generated: batchResults.length,
    kept: kept.length,
    deleted: toDelete.length,
  });
  return kept;
}
