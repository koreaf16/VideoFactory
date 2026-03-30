export enum PipelineStage {
  PROTAGONIST_PENDING = 'protagonist_pending',
  PROTAGONIST_VISUAL = 'protagonist_visual',
  SCRIPT_PENDING = 'script_pending',
  EPISODE_GENERATING = 'episode_generating',
  ASSETS_CREATING = 'assets_creating',
  SNAPSHOTS_GENERATING = 'snapshots_generating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
}

export const STAGE_ORDER: PipelineStage[] = [
  PipelineStage.PROTAGONIST_PENDING,
  PipelineStage.PROTAGONIST_VISUAL,
  PipelineStage.SCRIPT_PENDING,
  PipelineStage.EPISODE_GENERATING,
  PipelineStage.ASSETS_CREATING,
  PipelineStage.SNAPSHOTS_GENERATING,
  PipelineStage.COMPLETED,
];

export interface ProductionRun {
  runId: number;
  scriptId: number | null;
  protagonistId: string | null;
  currentStage: PipelineStage;
  currentEpNum: number;
  configJson: Record<string, unknown> | null;
  errorMessage: string | null;
  autoAdvance: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStep {
  stepId: number;
  runId: number;
  epId: number | null;
  stepType: string;
  stepStatus: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  inputJson: Record<string, unknown> | null;
  outputJson: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface CreateRunRequest {
  protagonistId?: string;
  scriptId?: number;
  protagonistPreset?: {
    name: string;
    nameEn?: string;
    role?: string;
    charType?: string;
    profile?: string | Record<string, unknown>;
    appearance?: Record<string, unknown>;
    promptBase?: string;
  };
  config?: Record<string, unknown>;
}

export interface AdvanceResult {
  previousStage: PipelineStage;
  currentStage: PipelineStage;
  message: string;
}

export interface AssetPreset {
  entityType: 'character' | 'location';
  entityId?: string;
  name: string;
  nameEn?: string;
  description?: string;
  appearance?: string;
  promptBase?: string;
  recurring: boolean;
  resolved?: boolean;
  resolveMode?: 'full' | 'prompt_only';
}
