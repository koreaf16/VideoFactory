/**
 * ============================================================
 *  Module: Post-Processing Domain Types
 * ============================================================
 *
 *  Defines composition configuration, per-scene assembly
 *  options, and final output result structures.
 *
 *  ┌────────────────────────────────────────────────┐
 *  │           CompositionConfig                    │
 *  │  epId, outputPath                              │
 *  │                                                │
 *  │  ┌──────────────────────────────────────┐      │
 *  │  │  scenes: SceneComposition[]          │      │
 *  │  │                                      │      │
 *  │  │  Scene 1 ──fade──► Scene 2 ──cut──►  │      │
 *  │  │   video + audio    video + audio     │      │
 *  │  └──────────────────────────────────────┘      │
 *  └─────────────────────┬──────────────────────────┘
 *                        │
 *                        ▼
 *  ┌────────────────────────────────────────────────┐
 *  │           CompositionResult                    │
 *  │  outputPath, durationSec, fileSize             │
 *  └────────────────────────────────────────────────┘
 *
 * ============================================================
 */

export type TransitionType = 'fade' | 'cut';

export interface SceneComposition {
  readonly sceneId: string;
  readonly videoPath: string;
  readonly audioPath?: string;
  readonly transition: TransitionType;
}

export interface CompositionConfig {
  readonly epId: string;
  readonly scenes: SceneComposition[];
  readonly outputPath: string;
}

export interface CompositionResult {
  readonly outputPath: string;
  readonly durationSec: number;
  readonly fileSize: number;
}
