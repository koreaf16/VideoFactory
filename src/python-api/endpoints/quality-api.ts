/**
 * @module 이미지 품질 평가 API 엔드포인트
 * @description Python FastAPI의 이미지 품질 스코어링 엔드포인트를 호출한다.
 *              레퍼런스 임베딩 대비 유사도 기반 품질 점수를 반환한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Node.js      │ ──→ │ pythonApi    │ ──→ │ Python       │
 * │ (품질 평가)   │     │ .post()     │     │ /api/quality │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies api-client
 * @author AI Video Factory
 */

import { pythonApi } from '../api-client';
import type { PythonApiResponse } from '../types/api-response.types';

/** 이미지 품질 평가 결과 */
interface ImageScoreResult {
  score: number;
  details: Record<string, number>;
}

/** 이미지 품질 점수를 평가한다 */
export async function scoreImage(
  imagePath: string,
  referenceEmbedding?: number[]
): Promise<PythonApiResponse<ImageScoreResult>> {
  return pythonApi.post<ImageScoreResult>('/api/quality/score-image', {
    image_path: imagePath,
    reference_embedding: referenceEmbedding,
  });
}
