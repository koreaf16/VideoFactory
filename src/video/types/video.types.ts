/**
 * ============================================================
 *  Module: Video Generation Domain Types
 * ============================================================
 *
 *  Defines video generation pipeline state, per-scene
 *  tracking, keyframe/video results, and GPU model state.
 *
 *  ┌────────────────────────────────────────────────┐
 *  │           VideoGenerationJob                   │
 *  │  epId, status, currentPass, progress           │
 *  │                                                │
 *  │  queued ─► flux_generating ─► model_switching  │
 *  │              │                     │           │
 *  │              ▼                     ▼           │
 *  │         KeyframeResult      wan_generating     │
 *  │                                    │           │
 *  │                              upscaling         │
 *  │                                    │           │
 *  │                              completed/failed  │
 *  └────────────┬───────────────────────────────────┘
 *               │  1:N
 *  ┌────────────▼────────────────┐
 *  │      SceneVideoState        │
 *  │  fluxStatus, wanStatus,     │
 *  │  upscaleStatus              │
 *  └─────────────────────────────┘
 *
 *  ┌──────────────┐
 *  │  ModelState   │
 *  │  currentModel │
 *  │  vramUsedMb   │
 *  └──────────────┘
 *
 * ============================================================
 */

export type VideoJobStatus =
  | 'queued'
  | 'flux_generating'
  | 'model_switching'
  | 'wan_generating'
  | 'upscaling'
  | 'completed'
  | 'failed';

export type VideoPass = 'flux' | 'wan' | 'upscale';

export type LoadedModel = 'flux' | 'wan' | 'none';

export interface SceneVideoState {
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly fluxStatus: string;
  readonly wanStatus: string;
  readonly upscaleStatus: string;
}

export interface VideoGenerationJob {
  readonly epId: string;
  readonly status: VideoJobStatus;
  readonly currentPass: VideoPass;
  readonly progress: number;
  readonly scenes: SceneVideoState[];
}

export interface KeyframeResult {
  readonly sceneId: string;
  readonly imagePath: string;
  readonly qualityScore?: number;
  readonly seed: number;
}

export interface VideoResult {
  readonly sceneId: string;
  readonly videoPath: string;
  readonly durationSec: number;
}

export interface ModelState {
  readonly currentModel: LoadedModel;
  readonly vramUsedMb: number;
}
