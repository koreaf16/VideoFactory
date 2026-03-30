/**
 * ============================================================
 *  Module: Episode Domain Types
 * ============================================================
 *
 *  Defines episode lifecycle, scene composition,
 *  dialogue scripting, and generation requests.
 *
 *  ┌──────────────────────────────────────────┐
 *  │               Episode                    │
 *  │  epId, title, status, scriptJson         │
 *  │                                          │
 *  │  draft ─► review ─► approved ─► generating
 *  │                                  │       │
 *  │                          completed ─► published
 *  └──────────┬───────────────────────────────┘
 *             │  1:N
 *  ┌──────────▼──────────────────────┐
 *  │            Scene                │
 *  │  sceneOrder, cameraType,       │
 *  │  emotion, durationSec          │
 *  │  ┌────────────────────┐        │
 *  │  │   SceneScript      │        │
 *  │  │  dialogues[], dir  │        │
 *  │  └────────────────────┘        │
 *  └─────────────────────────────────┘
 *
 * ============================================================
 */

export type EpisodeStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'generating'
  | 'completed'
  | 'published';

export interface DialogueLine {
  readonly character: string;
  readonly line: string;
  readonly emotion?: string;
  readonly action?: string;
}

export interface SceneScript {
  readonly dialogues: DialogueLine[];
  readonly direction?: string;
}

export interface Scene {
  readonly sceneId: string;
  readonly epId: string;
  readonly sceneOrder: number;
  readonly description?: string;
  readonly locationId?: string;
  readonly timeOfDay?: string;
  readonly cameraType?: string;
  readonly emotion?: string;
  readonly durationSec?: number;
  readonly script?: SceneScript;
  readonly characters?: Array<{ charId: string; name: string }>;
  readonly promptEn?: string;
  readonly motionPrompt?: string;
  readonly status: string;
  readonly keyframePath?: string;
  readonly videoPath?: string;
  readonly upscaledPath?: string;
  readonly ttsPath?: string;
  readonly qualityScore?: number;
  readonly createdAt: Date;
}

export interface Episode {
  readonly epId: string;
  readonly epNumber: number;
  readonly title: string;
  readonly synopsis?: string;
  readonly epType: string;
  readonly status: EpisodeStatus;
  readonly scriptJson?: string;
  readonly worldState?: string;
  readonly decisionReasoning?: string;
  readonly createdAt: Date;
  readonly approvedAt?: Date;
  readonly publishedAt?: Date;
}

export interface EpisodeGenerateRequest {
  readonly epNumber: number;
  readonly epType?: string;
  readonly characters?: string[];
}

export interface CreateSceneInput {
  readonly sceneOrder: number;
  readonly description?: string;
  readonly locationId?: string;
  readonly characters?: string[];
  readonly timeOfDay?: string;
  readonly cameraType?: string;
  readonly emotion?: string;
  readonly durationSec?: number;
  readonly script?: SceneScript;
  readonly promptEn?: string;
  readonly motionPrompt?: string;
}

export interface CreateEpisodeRequest {
  readonly epNumber: number;
  readonly title: string;
  readonly synopsis?: string;
  readonly epType?: string;
  readonly decisionReasoning?: string;
  readonly scriptId?: number;
  readonly scenes: CreateSceneInput[];
}

// ─── 서비스 응답 타입 ───────────────────────────────────────

export interface SceneDetail {
  readonly sceneId: number;
  readonly sceneOrder: number;
  readonly description: string | null;
  readonly locationId: string | null;
  readonly timeOfDay: string | null;
  readonly cameraType: string | null;
  readonly emotion: string | null;
  readonly durationSec: number | null;
  readonly script: SceneScript | null;
  readonly promptEn: string | null;
  readonly motionPrompt: string | null;
  readonly status: string;
  readonly characters: Array<{ charId: string; name: string }>;
}

export interface EpisodeDetail {
  readonly epId: number;
  readonly epNumber: number;
  readonly title: string | null;
  readonly synopsis: string | null;
  readonly epType: string;
  readonly status: string;
  readonly scriptId: number | null;
  readonly createdAt: Date;
  readonly approvedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly scenes: SceneDetail[];
}
