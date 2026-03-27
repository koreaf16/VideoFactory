/**
 * ============================================================
 *  Module: Audio Domain Types
 * ============================================================
 *
 *  Defines TTS request/result structures and
 *  background music selection for episode scenes.
 *
 *  ┌──────────────────────────────────────┐
 *  │           TTSRequest                 │
 *  │  sceneId                             │
 *  │  ┌─────────────────────────────┐     │
 *  │  │  dialogues[]                │     │
 *  │  │   character, line, emotion  │     │
 *  │  └─────────────────────────────┘     │
 *  └──────────────┬───────────────────────┘
 *                 │
 *                 ▼
 *  ┌──────────────────────────────────────┐
 *  │           TTSResult                  │
 *  │  sceneId, audioPath, durationSec     │
 *  └──────────────────────────────────────┘
 *
 *  ┌──────────────────────────────────────┐
 *  │          BGMSelection                │
 *  │  trackId, name, mood,               │
 *  │  path, durationSec                  │
 *  └──────────────────────────────────────┘
 *
 * ============================================================
 */

export interface TTSDialogue {
  readonly character: string;
  readonly line: string;
  readonly emotion?: string;
}

export interface TTSRequest {
  readonly sceneId: string;
  readonly dialogues: TTSDialogue[];
}

export interface TTSResult {
  readonly sceneId: string;
  readonly audioPath: string;
  readonly durationSec: number;
}

export interface BGMSelection {
  readonly trackId: string;
  readonly name: string;
  readonly mood: string;
  readonly path: string;
  readonly durationSec: number;
}
