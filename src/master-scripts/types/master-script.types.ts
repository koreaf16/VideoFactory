/**
 * ============================================================
 *  Module: Master Script Domain Types
 * ============================================================
 *
 *  마스터 스크립트 도메인의 타입을 정의한다.
 *  마스터 스크립트는 여러 에피소드를 묶는 상위 단위이다.
 *
 *  ┌────────────────────────────────────────────┐
 *  │              MasterScript                  │
 *  │  scriptId, title, genre, worldSetting      │
 *  │                                            │
 *  │  draft ─► active ─► completed ─► archived  │
 *  └───────────────┬────────────────────────────┘
 *                  │  1:N
 *  ┌───────────────▼──────────────┐
 *  │           Episode            │
 *  │  epId, epNumber, title       │
 *  └──────────────────────────────┘
 *
 * ============================================================
 */

export type MasterScriptStatus = 'draft' | 'active' | 'completed' | 'archived';

// ─── 요청 타입 ───────────────────────────────────────────

export interface CreateMasterScriptRequest {
  readonly title: string;
  readonly genre?: string;
  readonly synopsis?: string;
  readonly worldSetting?: string;
}

export interface UpdateMasterScriptRequest {
  readonly title?: string;
  readonly genre?: string;
  readonly synopsis?: string;
  readonly worldSetting?: string;
}

// ─── 응답 타입 ───────────────────────────────────────────

export interface MasterScriptEpisodeSummary {
  readonly epId: number;
  readonly epNumber: number;
  readonly title: string | null;
  readonly status: string;
  readonly createdAt: Date;
}

export interface MasterScriptDetail {
  readonly scriptId: number;
  readonly title: string;
  readonly genre: string | null;
  readonly synopsis: string | null;
  readonly worldSetting: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly episodes: MasterScriptEpisodeSummary[];
}

export interface MasterScriptSummary {
  readonly scriptId: number;
  readonly title: string;
  readonly genre: string | null;
  readonly status: string;
  readonly createdAt: Date;
}
