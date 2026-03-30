/**
 * @module MCP 에피소드 도구
 * @description VideoFactory REST API를 MCP 도구로 래핑 — 에피소드+씬 일괄 등록 및 상세 조회.
 *
 * ┌───────────────┐     ┌────────────────────────────┐     ┌────────────────────┐
 * │  Claude CLI   │ ──→ │  MCP Tool                  │ ──→ │  POST /api/episodes│
 * │  (MCP Client) │     │  create_episode_with_scenes│     │  GET  /api/episodes│
 * └───────────────┘     └────────────────────────────┘     └────────────────────┘
 *
 * @dependencies @modelcontextprotocol/sdk, zod
 * @author AI Video Factory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:2020';

async function apiCall(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json();
}

// ─── 씬 입력 스키마 ──────────────────────────────────────────

const dialogueLineSchema = z.object({
  character: z.string().describe('대사를 하는 캐릭터 이름'),
  line: z.string().describe('대사 내용'),
  emotion: z.string().optional().describe('감정 상태'),
  action: z.string().optional().describe('행동 지시'),
});

const sceneScriptSchema = z.object({
  dialogues: z.array(dialogueLineSchema).describe('씬의 대사 목록'),
  direction: z.string().optional().describe('연출 지시 (나레이션, 카메라 등)'),
});

const sceneInputSchema = z.object({
  sceneOrder: z.number().int().describe('씬 순서 번호 (1부터 시작)'),
  description: z.string().optional().describe('씬 설명'),
  locationId: z.string().optional().describe('장소 ID'),
  characters: z.array(z.string()).optional().describe('등장 캐릭터 ID 목록'),
  timeOfDay: z.string().optional().describe('시간대 (예: morning, night)'),
  cameraType: z.string().optional().describe('카메라 유형 (예: close-up, wide)'),
  emotion: z.string().optional().describe('씬의 전체 감정 톤'),
  durationSec: z.number().optional().describe('씬 예상 재생 시간(초)'),
  script: sceneScriptSchema.optional().describe('대사/연출 스크립트'),
  promptEn: z.string().optional().describe('이미지 생성 프롬프트 (영어)'),
  motionPrompt: z.string().optional().describe('영상 모션 프롬프트'),
});

export function registerEpisodeTools(server: McpServer): void {
  // ─── 에피소드+씬 일괄 등록 ────────────────────────────────

  server.tool(
    'create_episode_with_scenes',
    '에피소드와 하위 씬들을 한 번에 등록합니다. scriptId로 마스터 스크립트에 연결하고, scenes 배열로 씬을 일괄 입력합니다.',
    {
      scriptId: z.number().int().optional().describe('연결할 마스터 스크립트 ID'),
      epNumber: z.number().int().describe('에피소드 번호 (예: 1, 2, 3)'),
      title: z.string().describe('에피소드 제목'),
      synopsis: z.string().optional().describe('에피소드 시놉시스'),
      scenes: z.array(sceneInputSchema).describe('씬 목록 (최소 1개)'),
    },
    async (params) => {
      const result = await apiCall('/api/episodes', 'POST', params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── 에피소드 상세 조회 ───────────────────────────────────

  server.tool(
    'get_episode_detail',
    '에피소드 ID로 상세 정보(제목, 상태, 씬 목록, 대사 스크립트 등)를 조회합니다.',
    {
      epId: z.number().int().describe('조회할 에피소드 ID'),
    },
    async (params) => {
      const result = await apiCall(`/api/episodes/${params.epId}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
