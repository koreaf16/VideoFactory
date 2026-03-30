/**
 * @module ComfyUI WebSocket 클라이언트
 * @description ComfyUI 서버와 WebSocket/HTTP로 통신하는 클라이언트.
 *              워크플로우 제출, 진행률 추적, 결과 수신을 처리한다.
 *
 * ┌──────────────┐  WS   ┌──────────────┐  HTTP  ┌──────────────┐
 * │ ComfyUI      │ ←───→ │ ComfyUI      │ ────→  │ ComfyUI      │
 * │ Server       │       │ Client       │        │ Server       │
 * │ (8188)       │       │ (이 모듈)     │        │ /prompt      │
 * └──────────────┘       └──────────────┘        └──────────────┘
 *
 * @dependencies ws, config, logger, ws-handler
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../common/logger';
import { handleWsMessage, type PendingResult } from './ws-handler';
import type {
  ComfyUIWorkflow,
  ConnectionState,
  ImageResult,
  ProgressUpdate,
  PromptRequest,
  PromptResponse,
  SystemStats,
  ComfyUIResult,
} from './types/comfyui.types';

type ProgressCallback = (update: ProgressUpdate) => void;

class ComfyUIClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private readonly clientId: string = randomUUID();
  private progressCallbacks: ProgressCallback[] = [];
  private pendingResults: Map<string, PendingResult> = new Map();

  /* ─── 연결 관리 ─── */

  async connect(): Promise<void> {
    if (this.state === 'connected') return;
    this.state = 'connecting';
    const wsUrl = `${config.comfyui.wsUrl}?clientId=${this.clientId}`;
    logger.info('ComfyUI WebSocket 연결 시도', { url: wsUrl });

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => {
        this.state = 'connected';
        logger.info('ComfyUI WebSocket 연결 성공');
        resolve();
      });
      this.ws.on('error', (err: Error) => {
        this.state = 'error';
        logger.error('ComfyUI WebSocket 에러', { message: err.message });
        reject(err);
      });
      this.ws.on('close', () => {
        this.state = 'disconnected';
        logger.warn('ComfyUI WebSocket 연결 종료');
      });
      this.setupWebSocket();
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
    logger.info('ComfyUI WebSocket 연결 해제');
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  /* ─── HTTP API ─── */

  async getSystemStats(): Promise<SystemStats> {
    return this.httpRequest<SystemStats>('/system_stats', 'GET');
  }

  async uploadImage(filePath: string): Promise<string> {
    const url = `${config.comfyui.httpUrl}/upload/image`;
    const formData = new FormData();
    const pathMod = await import('node:path');
    const fs = await import('node:fs/promises');
    const stats = await fs.stat(filePath);
    const buffer = await fs.readFile(filePath);
    const blob = new Blob([buffer]);
    const file = new File([blob], pathMod.basename(filePath), {
      type: 'image/png',
      lastModified: stats.mtimeMs,
    });
    formData.append('image', file);
    formData.append('overwrite', 'true');
    logger.info('ComfyUI 이미지 업로드 시도', { path: filePath });

    const response = await fetch(url, { method: 'POST', body: formData });
    if (!response.ok)
      throw new Error(`ComfyUI 업로드 에러: ${response.status} ${response.statusText}`);
    const res = (await response.json()) as { name: string };
    logger.info('ComfyUI 이미지 업로드 성공', { filename: res.name });
    return res.name;
  }

  async submitWorkflow(workflow: ComfyUIWorkflow): Promise<string> {
    const body: PromptRequest = { prompt: workflow, client_id: this.clientId };
    const res = await this.httpRequest<PromptResponse>('/prompt', 'POST', body);
    if (res.error) {
      throw new Error(`ComfyUI 워크플로우 거부 — ${res.error.message} (${res.error.type})`);
    }
    if (Object.keys(res.node_errors).length > 0) {
      const missing = Object.entries(res.node_errors)
        .map(([id, err]) => `노드 #${id}: ${JSON.stringify(err)}`)
        .join(', ');
      throw new Error(`ComfyUI 워크플로우 노드 에러 — ${missing}`);
    }
    if (!res.prompt_id) {
      throw new Error('ComfyUI 응답에 prompt_id 없음');
    }
    logger.info('워크플로우 제출 완료', { promptId: res.prompt_id });
    return res.prompt_id;
  }

  async waitForResult(
    promptId: string,
    timeoutMs: number = 120_000,
    abortSignal?: AbortSignal,
  ): Promise<ComfyUIResult> {
    return new Promise<ComfyUIResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResults.delete(promptId);
        reject(new Error(`ComfyUI 결과 대기 타임아웃: ${promptId}`));
      }, timeoutMs);

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          this.pendingResults.delete(promptId);
          reject(new Error(`ComfyUI 작업 중단됨: ${promptId}`));
        });
      }

      this.pendingResults.set(promptId, {
        resolve: (result: ComfyUIResult) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
        images: [],
        texts: [],
      });
    });
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  cancelPendingResult(promptId: string): void {
    const pending = this.pendingResults.get(promptId);
    if (pending) {
      this.pendingResults.delete(promptId);
      pending.reject(new Error(`ComfyUI 작업 중단됨: ${promptId}`));
    }
  }

  /* ─── Private ─── */

  private setupWebSocket(): void {
    if (!this.ws) return;
    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as ProgressUpdate;
        handleWsMessage(msg, this.pendingResults, this.progressCallbacks);
      } catch {
        logger.debug('WebSocket 메시지 파싱 실패 (바이너리일 수 있음)');
      }
    });
  }

  private async httpRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = `${config.comfyui.httpUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    if (!response.ok)
      throw new Error(`ComfyUI HTTP 에러: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }
}

export const comfyuiClient = new ComfyUIClient();
