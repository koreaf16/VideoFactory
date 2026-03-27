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
 *                              ↓
 *                        ┌──────────────┐
 *                        │ ImageResult  │
 *                        │ (생성 결과)   │
 *                        └──────────────┘
 *
 * @dependencies ws, config, logger
 * @author AI Video Factory
 */

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../common/logger';
import type {
  ComfyUIWorkflow,
  ConnectionState,
  ImageResult,
  ProgressUpdate,
  PromptRequest,
  PromptResponse,
  SystemStats,
} from './types/comfyui.types';

type ProgressCallback = (update: ProgressUpdate) => void;

interface PendingResult {
  resolve: (images: ImageResult[]) => void;
  reject: (error: Error) => void;
  images: ImageResult[];
}

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

  async submitWorkflow(workflow: ComfyUIWorkflow): Promise<string> {
    const body: PromptRequest = { prompt: workflow, client_id: this.clientId };
    const res = await this.httpRequest<PromptResponse>('/prompt', 'POST', body);

    if (Object.keys(res.node_errors).length > 0) {
      logger.warn('워크플로우 노드 에러 발생', { errors: res.node_errors });
    }
    logger.info('워크플로우 제출 완료', { promptId: res.prompt_id });
    return res.prompt_id;
  }

  async waitForResult(promptId: string, timeoutMs: number = 120_000): Promise<ImageResult[]> {
    return new Promise<ImageResult[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResults.delete(promptId);
        reject(new Error(`ComfyUI 결과 대기 타임아웃: ${promptId}`));
      }, timeoutMs);

      this.pendingResults.set(promptId, {
        resolve: (images: ImageResult[]) => {
          clearTimeout(timer);
          resolve(images);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
        images: [],
      });
    });
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /* ─── Private ─── */

  private setupWebSocket(): void {
    if (!this.ws) return;

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as ProgressUpdate;
        this.handleMessage(msg);
      } catch {
        logger.debug('WebSocket 메시지 파싱 실패 (바이너리일 수 있음)');
      }
    });
  }

  private handleMessage(msg: ProgressUpdate): void {
    for (const cb of this.progressCallbacks) {
      cb(msg);
    }

    if (msg.type === 'executed') {
      // executed 메시지 구조: { type, node, output: { images: [...] }, prompt_id }
      const raw = msg as unknown as Record<string, unknown>;
      const promptId = raw['prompt_id'] as string | undefined;
      const output = raw['output'] as { images?: ImageResult[] } | undefined;
      if (promptId && output?.images) {
        const pending = this.pendingResults.get(promptId);
        if (pending) {
          pending.images.push(...output.images);
        }
      }
    }

    if (msg.type === 'execution_success' && msg.data.prompt_id) {
      const pending = this.pendingResults.get(msg.data.prompt_id);
      if (pending) {
        this.pendingResults.delete(msg.data.prompt_id);
        // history API에서 최종 결과 가져오기 (executed 이벤트보다 안정적)
        this.fetchHistoryImages(msg.data.prompt_id)
          .then((images) => pending.resolve(images))
          .catch(() => pending.resolve(pending.images));
        logger.info('워크플로우 실행 완료', { promptId: msg.data.prompt_id });
      }
    }

    if (msg.type === 'execution_error') {
      const promptId = msg.data.prompt_id ?? (msg as unknown as Record<string, unknown>)['prompt_id'] as string;
      if (promptId) {
        const pending = this.pendingResults.get(promptId);
        if (pending) {
          this.pendingResults.delete(promptId);
          const errMsg = (msg.data as Record<string, unknown>).exception_message;
          pending.reject(new Error(`ComfyUI 실행 에러: ${errMsg ?? 'unknown'}`));
        }
      }
    }
  }

  private async fetchHistoryImages(promptId: string): Promise<ImageResult[]> {
    const history = await this.httpRequest<Record<string, {
      outputs?: Record<string, { images?: ImageResult[] }>;
    }>>(`/history/${promptId}`, 'GET');
    const entry = history[promptId];
    if (!entry?.outputs) return [];
    const images: ImageResult[] = [];
    for (const nodeOutput of Object.values(entry.outputs)) {
      if (nodeOutput.images) images.push(...nodeOutput.images);
    }
    return images;
  }

  private async httpRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = `${config.comfyui.httpUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`ComfyUI HTTP 에러: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}

export const comfyuiClient = new ComfyUIClient();
