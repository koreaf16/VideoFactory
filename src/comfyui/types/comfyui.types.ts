/**
 * @module ComfyUI 타입 정의
 * @description ComfyUI API 통신에 필요한 모든 타입을 정의한다.
 *              워크플로우 구조, 요청/응답, 시스템 상태, 진행률 등을 포함한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ WorkflowJSON │ ──→ │ PromptReq    │ ──→ │ ComfyUI API  │
 * │ (노드 그래프) │     │ (제출 요청)   │     │ (HTTP/WS)    │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *                                                  ↓
 *                      ┌──────────────┐     ┌──────────────┐
 *                      │ ImageResult  │ ←── │ ProgressUpd  │
 *                      │ (생성 결과)   │     │ (진행 상황)   │
 *                      └──────────────┘     └──────────────┘
 *
 * @dependencies none
 * @author AI Video Factory
 */

/* ─── 워크플로우 구조 ─── */

/** ComfyUI 노드 하나의 구조 */
export interface ComfyUINode {
  class_type: string;
  inputs: Record<string, unknown>;
}

/** ComfyUI 워크플로우 JSON — 노드 ID를 키로 하는 맵 */
export type ComfyUIWorkflow = Record<string, ComfyUINode>;

/* ─── HTTP API 요청/응답 ─── */

/** POST /prompt 요청 바디 */
export interface PromptRequest {
  prompt: ComfyUIWorkflow;
  client_id?: string;
}

/** POST /prompt 응답 — 유효하지 않은 워크플로우는 prompt_id 없이 error 포함 */
export interface PromptResponse {
  prompt_id?: string;
  number?: number;
  node_errors: Record<string, unknown>;
  error?: { type: string; message: string; details?: string; extra_info?: unknown };
}

/** GET /system_stats 응답 */
export interface SystemStats {
  system: {
    os: string;
    comfyui_version: string;
    gpu_name?: string;
    vram_total?: number;
    vram_free?: number;
  };
}

/* ─── 결과 및 진행률 ─── */

/** 생성 완료된 이미지 정보 */
export interface ImageResult {
  filename: string;
  subfolder: string;
  type: string;
}

/** 생성 완료된 모든 결과 (이미지 + 텍스트) */
export interface ComfyUIResult {
  images: ImageResult[];
  texts: string[];
}

/** WebSocket 진행률 메시지 */
export interface ProgressUpdate {
  type: string;
  data: {
    value: number;
    max: number;
    prompt_id?: string;
    node?: string;
  };
}

/* ─── 연결 상태 ─── */

/** WebSocket 연결 상태 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';
