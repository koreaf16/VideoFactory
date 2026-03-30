/**
 * ============================================================
 *  Module: Character Domain Types
 * ============================================================
 *
 *  Defines core character entities, appearance profiles,
 *  candidate generation, and reference image structures.
 *
 *  ┌─────────────────────────────────────────────────┐
 *  │                  Character                      │
 *  │  ┌──────────────┐  ┌───────────────────────┐   │
 *  │  │ CharProfile  │  │ CharAppearance        │   │
 *  │  │  personality │  │  hair_color, eye_color │   │
 *  │  │  speech_style│  │  outfit, accessories   │   │
 *  │  └──────────────┘  └───────────────────────┘   │
 *  └────────┬────────────────────┬──────────────────┘
 *           │                    │
 *    ┌──────▼──────┐     ┌──────▼──────┐
 *    │ CharCandidate│     │ CharRefImage│
 *    │  imagePath   │     │  poseTag    │
 *    │  qualityScore│     │  approved   │
 *    └─────────────┘     └─────────────┘
 *
 * ============================================================
 */

export interface CharacterProfile {
  readonly personality: string;
  readonly speech_style: string;
  readonly catchphrase?: string;
  readonly background: string;
  readonly hobby?: string;
  readonly likes?: string;
  readonly dislikes?: string;
}

export interface CharacterAppearance {
  readonly hair_color: string;
  readonly hair_style: string;
  readonly eye_color: string;
  readonly skin_tone: string;
  readonly outfit: string;
  readonly height?: string;
  readonly accessories?: string;
}

export interface Character {
  readonly charId: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly role?: string;
  readonly charType: string;
  readonly profile: CharacterProfile;
  readonly appearance: CharacterAppearance;
  readonly promptBase?: string;
  readonly voiceConfig?: string;
  readonly mood?: string;
  readonly anchor_id?: number;
  readonly loraPath?: string;
  readonly createdAt: Date;
}

export interface CharCandidate {
  readonly candidateId: string;
  readonly charId: string;
  readonly jobId: string;
  readonly imagePath: string;
  readonly promptText?: string;
  readonly seed?: number;
  readonly qualityScore?: number;
  readonly grade?: string;
  readonly liked: boolean;
  readonly isAnchor: boolean;
  readonly createdAt: Date;
}

export interface CharRefImage {
  readonly refId: string;
  readonly charId: string;
  readonly imagePath: string;
  readonly poseTag?: string;
  readonly qualityScore?: number;
  readonly approved: boolean;
  readonly createdAt: Date;
}

export type AnchorMode = 'reference' | 'prompt';

export interface CandidateGenerateRequest {
  readonly charId: string;
  readonly count?: number;
  readonly mode?: AnchorMode;
  readonly pulidStrength?: number;
  readonly guidance?: number;
}

export interface AnchorConfirmRequest {
  readonly anchorCandidateId: string;
}
