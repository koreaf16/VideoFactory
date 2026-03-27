/**
 * ============================================================
 *  Module: Job Queue Domain Types
 * ============================================================
 *
 *  Defines the base job interface and specialized job types
 *  for image generation, video generation, TTS, and
 *  post-processing pipelines.
 *
 *  ┌──────────────────────────────────────────────┐
 *  │               BaseJob                        │
 *  │  jobId, status, createdAt, error?            │
 *  │                                              │
 *  │  queued ─► active ─► completed               │
 *  │              │                               │
 *  │              └──► failed                     │
 *  └──────┬───────┬──────────┬──────────┬─────────┘
 *         │       │          │          │
 *  ┌──────▼──┐ ┌──▼─────┐ ┌─▼────┐ ┌───▼────────┐
 *  │ImageGen │ │VideoGen│ │ TTS  │ │Postprocess │
 *  │Job      │ │Job     │ │ Job  │ │Job         │
 *  │ charId  │ │ epId   │ │epId  │ │ epId       │
 *  │ prompts │ │ pass   │ │scene │ │ outputPath │
 *  │ batch   │ │ scenes │ │ Ids  │ │            │
 *  └─────────┘ └────────┘ └──────┘ └────────────┘
 *
 * ============================================================
 */

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';

export type VideoPassType = 'flux' | 'wan' | 'upscale';

export interface BaseJob {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly error?: string;
}

export interface ImageGenJob extends BaseJob {
  readonly charId: string;
  readonly prompts: string[];
  readonly batchSize: number;
}

export interface VideoGenJob extends BaseJob {
  readonly epId: string;
  readonly pass: VideoPassType;
  readonly sceneIds: number[];
}

export interface TTSJob extends BaseJob {
  readonly epId: string;
  readonly sceneIds: number[];
}

export interface PostprocessJob extends BaseJob {
  readonly epId: string;
  readonly outputPath: string;
}
