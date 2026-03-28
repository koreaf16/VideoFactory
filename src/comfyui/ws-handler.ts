/**
 * @module ComfyUI WebSocket 메시지 핸들러
 * @description WebSocket 메시지 파싱 및 pending result 관리 로직
 *
 * @dependencies comfyui.types, config, logger
 * @author AI Video Factory
 */

import { config } from '../config';
import { logger } from '../common/logger';
import type { ImageResult, ProgressUpdate } from './types/comfyui.types';

type ProgressCallback = (update: ProgressUpdate) => void;

export interface PendingResult {
  resolve: (images: ImageResult[]) => void;
  reject: (error: Error) => void;
  images: ImageResult[];
  abortController?: AbortController;
}

/** history API에서 최종 결과를 가져온다. */
export async function fetchHistoryImages(promptId: string): Promise<ImageResult[]> {
  const url = `${config.comfyui.httpUrl}/history/${promptId}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`ComfyUI history 조회 실패: ${res.status}`);

  const history = (await res.json()) as Record<
    string,
    {
      outputs?: Record<string, { images?: ImageResult[] }>;
    }
  >;
  const entry = history[promptId];
  if (!entry?.outputs) return [];
  const images: ImageResult[] = [];
  for (const nodeOutput of Object.values(entry.outputs)) {
    if (nodeOutput.images) images.push(...nodeOutput.images);
  }
  return images;
}

/** WebSocket 메시지를 처리한다. */
export function handleWsMessage(
  msg: ProgressUpdate,
  pendingResults: Map<string, PendingResult>,
  progressCallbacks: ProgressCallback[],
): void {
  for (const cb of progressCallbacks) cb(msg);

  if (msg.type === 'executed') {
    const raw = msg as unknown as Record<string, unknown>;
    const promptId = raw['prompt_id'] as string | undefined;
    const output = raw['output'] as { images?: ImageResult[] } | undefined;
    if (promptId && output?.images) {
      const pending = pendingResults.get(promptId);
      if (pending) pending.images.push(...output.images);
    }
  }

  if (msg.type === 'execution_success' && msg.data.prompt_id) {
    const pending = pendingResults.get(msg.data.prompt_id);
    if (pending) {
      pendingResults.delete(msg.data.prompt_id);
      fetchHistoryImages(msg.data.prompt_id)
        .then((images) => pending.resolve(images))
        .catch(() => pending.resolve(pending.images));
      logger.info('워크플로우 실행 완료', { promptId: msg.data.prompt_id });
    }
  }

  if (msg.type === 'execution_error') {
    const promptId =
      msg.data.prompt_id ?? ((msg as unknown as Record<string, unknown>)['prompt_id'] as string);
    if (promptId) {
      const pending = pendingResults.get(promptId);
      if (pending) {
        pendingResults.delete(promptId);
        const errMsg = (msg.data as Record<string, unknown>).exception_message;
        pending.reject(new Error(`ComfyUI 실행 에러: ${errMsg ?? 'unknown'}`));
      }
    }
  }
}
