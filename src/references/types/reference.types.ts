/**
 * ============================================================
 *  Module: Reference Asset Domain Types
 * ============================================================
 *
 *  Defines image, voice, and external reference assets
 *  used for consistency across generation pipelines.
 *
 *  ┌──────────────────────────────────────────────┐
 *  │           ImageReference                     │
 *  │  refId, entityType, entityId,                │
 *  │  imagePath, embedding[], qualityScore        │
 *  └──────────────────────────────────────────────┘
 *
 *  ┌──────────────────────────────────────────────┐
 *  │           VoiceReference                     │
 *  │  refId, charId, emotionTag,                  │
 *  │  audioPath, ttsConfig, embedding[]           │
 *  └──────────────────────────────────────────────┘
 *
 *  ┌──────────────────────────────────────────────┐
 *  │         ExternalReference                    │
 *  │  refId, type: image | audio | prompt,        │
 *  │  sourceUrl, license, embedding[]             │
 *  └──────────────────────────────────────────────┘
 *
 * ============================================================
 */

export type ReferenceEntityType = 'character' | 'location' | 'item';

export type ExternalReferenceType = 'image' | 'audio' | 'prompt';

export interface ImageReference {
  readonly refId: string;
  readonly entityType: ReferenceEntityType;
  readonly entityId: string;
  readonly imagePath: string;
  readonly embedding?: number[];
  readonly qualityScore?: number;
  readonly approved: boolean;
}

export interface VoiceReference {
  readonly refId: string;
  readonly charId: string;
  readonly emotionTag: string;
  readonly audioPath: string;
  readonly ttsConfig?: string;
  readonly embedding?: number[];
}

export interface ExternalReference {
  readonly refId: string;
  readonly type: ExternalReferenceType;
  readonly sourceUrl: string;
  readonly license: string;
  readonly embedding?: number[];
}
