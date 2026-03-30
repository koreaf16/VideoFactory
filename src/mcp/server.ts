/**
 * @module MCP 서버 진입점
 * @description VideoFactory API를 Claude CLI에 노출하는 MCP 서버.
 *              stdio 전송으로 동작하며, stdout은 MCP 프로토콜 전용이므로
 *              디버그 출력은 반드시 stderr로 써야 한다.
 *
 * ┌──────────────┐  stdio  ┌──────────────────┐  HTTP  ┌────────────────────┐
 * │  Claude CLI  │ ──────→ │   MCP Server     │ ─────→ │  VideoFactory API  │
 * │  (MCP Client)│ ←────── │  (this process)  │ ←───── │  localhost:2020    │
 * └──────────────┘         └──────────────────┘        └────────────────────┘
 *
 * Tools:
 *   - create_master_script   마스터 스크립트 등록
 *   - get_master_script      마스터 스크립트 조회
 *   - create_episode_with_scenes  에피소드+씬 일괄 등록
 *   - get_episode_detail     에피소드 상세 조회
 *   - list_characters        캐릭터 목록 조회
 *   - list_locations         장소 목록 조회
 *
 * @dependencies @modelcontextprotocol/sdk
 * @author AI Video Factory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { registerMasterScriptTools } from './tools/master-script';
import { registerEpisodeTools } from './tools/episode';
import { registerResourceTools } from './tools/resource';

// ─── 서버 생성 ────────────────────────────────────────────────

const server = new McpServer({
  name: 'videofactory',
  version: '0.1.0',
});

// ─── 도구 등록 ────────────────────────────────────────────────

registerMasterScriptTools(server);
registerEpisodeTools(server);
registerResourceTools(server);

// ─── stdio 전송으로 연결 ──────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[MCP] VideoFactory MCP server started (stdio)\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`[MCP] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
