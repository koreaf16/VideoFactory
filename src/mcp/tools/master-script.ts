/**
 * @module MCP 마스터 스크립트 도구
 * @description VideoFactory REST API를 MCP 도구로 래핑 — 마스터 스크립트 생성 및 조회.
 *
 * ┌───────────────┐     ┌──────────────────────┐     ┌────────────────────────────┐
 * │  Claude CLI   │ ──→ │  MCP Tool             │ ──→ │  POST /api/master-scripts  │
 * │  (MCP Client) │     │  create_master_script │     │  GET  /api/master-scripts/:id│
 * └───────────────┘     └──────────────────────┘     └────────────────────────────┘
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

export function registerMasterScriptTools(server: McpServer): void {
  // ─── 마스터 스크립트 생성 ──────────────────────────────────

  server.tool(
    'create_master_script',
    '마스터 스크립트(시리즈 기획안)를 새로 등록합니다. 제목은 필수이며, 장르·시놉시스·세계관 설정을 함께 입력할 수 있습니다.',
    {
      title: z.string().describe('마스터 스크립트 제목 (필수)'),
      genre: z.string().optional().describe('장르 (예: 이세계판타지, 로맨스)'),
      synopsis: z.string().optional().describe('전체 시리즈 시놉시스'),
      worldSetting: z.string().optional().describe('세계관 설정 텍스트'),
    },
    async (params) => {
      const result = await apiCall('/api/master-scripts', 'POST', params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── 마스터 스크립트 상세 조회 ────────────────────────────

  server.tool(
    'get_master_script',
    '마스터 스크립트 ID로 상세 정보(제목, 장르, 시놉시스, 세계관, 하위 에피소드 목록)를 조회합니다.',
    {
      scriptId: z.number().int().describe('조회할 마스터 스크립트 ID'),
    },
    async (params) => {
      const result = await apiCall(`/api/master-scripts/${params.scriptId}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
