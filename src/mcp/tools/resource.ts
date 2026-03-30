/**
 * @module MCP 리소스 목록 도구
 * @description VideoFactory REST API를 MCP 도구로 래핑 — 캐릭터 및 장소 목록 조회.
 *
 * ┌───────────────┐     ┌──────────────────┐     ┌──────────────────────┐
 * │  Claude CLI   │ ──→ │  MCP Tool         │ ──→ │  GET /api/characters │
 * │  (MCP Client) │     │  list_characters  │     │  GET /api/locations  │
 * └───────────────┘     └──────────────────┘     └──────────────────────┘
 *
 * @dependencies @modelcontextprotocol/sdk
 * @author AI Video Factory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:2020';

async function apiCall(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}

export function registerResourceTools(server: McpServer): void {
  // ─── 캐릭터 목록 ──────────────────────────────────────────

  server.tool(
    'list_characters',
    '등록된 모든 캐릭터 목록을 조회합니다. 캐릭터 ID, 이름, 역할, LoRA 경로 등의 정보를 반환합니다.',
    {},
    async () => {
      const result = await apiCall('/api/characters');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── 장소 목록 ────────────────────────────────────────────

  server.tool(
    'list_locations',
    '등록된 모든 장소 목록을 조회합니다. 장소 ID, 이름, 설명, 앵커 이미지 경로 등의 정보를 반환합니다.',
    {},
    async () => {
      const result = await apiCall('/api/locations');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
