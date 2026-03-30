/**
 * @module 앵커 이미지 타입
 * @description 캐릭터/장소/NPC의 앵커 이미지 생성 및 관리 타입
 */

export type AnchorEntityType = 'character' | 'location' | 'npc';

export interface AnchorGenerationRequest {
  entityType: AnchorEntityType;
  entityId: string;
  count: number;
  customPrompt?: string;
  pulidOpts?: PulidModeOptions;
}

export interface PulidModeOptions {
  referenceImagePath: string;
  pulidStrength: number;
  guidance: number;
}

export interface AnchorResult {
  anchorId?: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  prompt: string;
  seed: number;
  qualityScore?: number;
  grade?: string;
}

export interface AnchorGenerationJob {
  jobId: string;
  entityType: AnchorEntityType;
  entityId: string;
  status: 'generating' | 'scoring' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  anchors: AnchorResult[];
  lastError?: string;
  shouldStop?: boolean;
}

export interface AnchorImageRow {
  anchor_id: number;
  entity_type: AnchorEntityType;
  entity_id: string;
  image_blob: Buffer;
  thumbnail_blob?: Buffer;
  image_path?: string;
  job_id?: string;
  prompt_text?: string;
  seed?: number;
  quality_score?: number;
  grade?: string;
  face_bbox?: string;
  face_embedding?: Buffer;
  created_at: Date;
  updated_at: Date;
}

export interface AnchorInsertData {
  entityType: AnchorEntityType;
  entityId: string;
  imageBlob: Buffer;
  thumbnailBlob: Buffer;
  jobId: string;
  promptText: string;
  seed: number;
  qualityScore: number | null;
  grade: string | null;
  faceBbox: string | null;
}
