/**
 * @module 장소 도메인 타입
 * @description 장소 엔티티, 후보, 레퍼런스 이미지 인터페이스.
 *
 * @author AI Video Factory
 */

export interface Location {
  readonly locationId: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly regionId?: string;
  readonly locationType?: string;
  readonly promptBase?: string;
  readonly description?: string;
  readonly firstEp?: number;
  readonly anchor_id?: number;
  readonly loraPath?: string;
  readonly createdAt: Date;
}

export interface LocationCandidate {
  readonly candidateId: number;
  readonly locationId: string;
  readonly jobId: string;
  readonly imagePath: string;
  readonly promptText?: string;
  readonly seed?: number;
  readonly qualityScore?: number;
  readonly liked: boolean;
  readonly isAnchor: boolean;
  readonly createdAt: Date;
}

export interface LocationRefImage {
  readonly refId: number;
  readonly locationId: string;
  readonly imagePath: string;
  readonly angle?: string;
  readonly timeOfDay?: string;
  readonly weather?: string;
  readonly qualityScore?: number;
  readonly isAnchor: boolean;
  readonly approved: boolean;
  readonly createdAt: Date;
}

export type LocationType = 'main' | 'sub' | 'background';
