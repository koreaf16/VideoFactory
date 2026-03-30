/**
 * @module ComfyUI WebSocket 메시지 핸들러
 * @description WebSocket 메시지 파싱 및 pending result 관리 로직
 *
 * @dependencies comfyui.types, config, logger
 * @author AI Video Factory
 */

import { config } from '../config';
import { logger } from '../common/logger';
import type { ImageResult, ProgressUpdate, ComfyUIResult } from './types/comfyui.types';

type ProgressCallback = (update: ProgressUpdate) => void;

export interface PendingResult {
  resolve: (result: ComfyUIResult) => void;
  reject: (error: Error) => void;
  images: ImageResult[];
  texts: string[];
  abortController?: AbortController;
}

/** history API에서 최종 결과를 가져온다. */
export async function fetchHistoryResults(promptId: string): Promise<ComfyUIResult> {
  const url = `${config.comfyui.httpUrl}/history/${promptId}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`ComfyUI history 조회 실패: ${res.status}`);

  const history = (await res.json()) as Record<
    string,
    {
      outputs?: Record<string, { images?: ImageResult[]; text?: string[] }>;
    }
  >;
  const entry = history[promptId];
  if (!entry?.outputs) return { images: [], texts: [] };
  
  const images: ImageResult[] = [];
  const texts: string[] = [];
  
  for (const nodeOutput of Object.values(entry.outputs)) {
    if (nodeOutput.images) images.push(...nodeOutput.images);
    if (nodeOutput.text) texts.push(...nodeOutput.text);
  }
  return { images, texts };
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
    const output = raw['output'] as { images?: ImageResult[]; text?: string[] } | undefined;
    if (promptId && output) {
      const pending = pendingResults.get(promptId);
      if (pending) {
        if (output.images) pending.images.push(...output.images);
        if (output.text) pending.texts.push(...output.text);
      }
    }
  }

  if (msg.type === 'execution_success' && msg.data.prompt_id) {
    const pending = pendingResults.get(msg.data.prompt_id);
    if (pending) {
      pendingResults.delete(msg.data.prompt_id);
      fetchHistoryResults(msg.data.prompt_id)
        .then((res) => pending.resolve(res))
        .catch(() => pending.resolve({ images: pending.images, texts: pending.texts }));
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
