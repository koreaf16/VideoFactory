/**
 * @module 임베딩 API 엔드포인트
 * @description Python FastAPI의 임베딩 생성 엔드포인트를 호출한다.
 *              이미지(CLIP)와 텍스트(MiniLM) 임베딩을 생성한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Node.js      │ ──→ │ pythonApi    │ ──→ │ Python       │
 * │ (임베딩 요청) │     │ .post()     │     │ /api/embed   │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies api-client
 * @author AI Video Factory
 */

import { config } from '../../config';
import { pythonApi } from '../api-client';
import type { PythonApiResponse } from '../types/api-response.types';

/** 임베딩 결과 */
interface EmbeddingResult {
  embedding: number[];
}

/** 얼굴 비교 결과 (개별) */
export interface FaceCompareItem {
  path: string;
  distance: number;
  similar: boolean;
  has_face: boolean;
}

/** 얼굴 비교 응답 */
export interface FaceCompareResult {
  results: FaceCompareItem[];
  similar_count: number;
  total_count: number;
}

/** 이미지 임베딩 생성 (CLIP) */
export async function getImageEmbedding(
  imagePath: string
): Promise<PythonApiResponse<EmbeddingResult>> {
  return pythonApi.post<EmbeddingResult>('/api/embedding/image', {
    image_path: imagePath,
  });
}

/** 텍스트 임베딩 생성 (MiniLM) */
export async function getTextEmbedding(
  text: string
): Promise<PythonApiResponse<EmbeddingResult>> {
  return pythonApi.post<EmbeddingResult>('/api/embedding/text', { text });
}

/** 앵커 기준 얼굴 유사도 비교 (face_recognition / dlib) */
export async function compareFaces(
  anchorPath: string,
  imagePaths: string[],
  threshold: number = 0.4,
): Promise<FaceCompareResult> {
  const resp = await fetch(`${config.pythonApi.baseUrl}/api/embedding/face/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anchor_path: anchorPath,
      image_paths: imagePaths,
      threshold,
    }),
  });

  if (!resp.ok) {
    throw new Error(`얼굴 비교 API 실패: ${resp.status}`);
  }

  return resp.json() as Promise<FaceCompareResult>;
}
