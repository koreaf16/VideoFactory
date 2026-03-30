# Script-Driven Episode Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude CLI가 MCP 도구로 마스터 대본과 에피소드/씬을 생성하고, 웹 UI에서 검수하는 파이프라인 구축

**Architecture:** MASTER_SCRIPTS 테이블 추가, episodes에 script_id FK 추가. MCP 서버는 기존 REST API를 래핑하는 thin wrapper. 웹 UI에 마스터 대본 조회 페이지 추가.

**Tech Stack:** Node.js, TypeScript, Express, Oracle 26ai, @modelcontextprotocol/sdk, oracledb

---

### Task 1: DB Migration — master_scripts 테이블 + episodes.script_id

**Files:**
- Create: `src/db/migrations/005_master_scripts.sql`

- [ ] **Step 1: Write migration SQL**

Create `src/db/migrations/005_master_scripts.sql`:

```sql
-- ============================================================
-- Master Scripts + Episodes FK — Oracle 26ai
-- ============================================================

-- 1. master_scripts: 마스터 대본 테이블
CREATE TABLE master_scripts (
  script_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         VARCHAR2(200)  NOT NULL,
  genre         VARCHAR2(100),
  synopsis      CLOB,
  world_setting CLOB,
  status        VARCHAR2(20) DEFAULT 'active'
                CHECK (status IN ('draft','active','completed','archived')),
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 2. episodes.script_id FK
ALTER TABLE episodes ADD (
  script_id NUMBER REFERENCES master_scripts(script_id)
);

-- 3. 인덱스
CREATE INDEX idx_episodes_script_id ON episodes(script_id);
```

- [ ] **Step 2: Run migration**

```bash
cd /c/VideoFactory && npx tsx scripts/run-migration.ts src/db/migrations/005_master_scripts.sql
```

If run-migration.ts doesn't support file args, run manually via `npx tsx -e` with the SQL statements executed one at a time.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/005_master_scripts.sql
git commit -m "feat: add master_scripts table and episodes.script_id FK"
```

---

### Task 2: Master Script DB Queries

**Files:**
- Create: `src/db/queries/master-script-queries.ts`

- [ ] **Step 1: Create query module**

Create `src/db/queries/master-script-queries.ts`:

```typescript
/**
 * @module 마스터 대본 쿼리
 * @description master_scripts 테이블에 대한 SQL 쿼리를 정의한다.
 *
 * ┌──────────────┐     ┌──────────────────────┐     ┌──────────┐
 * │ Service      │ ──→ │ master-script-queries │ ──→ │ Oracle   │
 * │ (비즈니스)    │     │ (SQL 정의)            │     │ 26ai DB  │
 * └──────────────┘     └──────────────────────┘     └──────────┘
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const LIST_ALL = `
  SELECT script_id, title, genre, synopsis, world_setting,
         status, created_at, updated_at
    FROM master_scripts
   ORDER BY created_at DESC
`;

export const FIND_BY_ID = `
  SELECT script_id, title, genre, synopsis, world_setting,
         status, created_at, updated_at
    FROM master_scripts
   WHERE script_id = :scriptId
`;

export const INSERT = `
  INSERT INTO master_scripts (title, genre, synopsis, world_setting)
  VALUES (:title, :genre, :synopsis, :worldSetting)
  RETURNING script_id INTO :scriptId
`;

export const UPDATE = `
  UPDATE master_scripts
     SET title         = :title,
         genre         = :genre,
         synopsis      = :synopsis,
         world_setting = :worldSetting,
         updated_at    = SYSTIMESTAMP
   WHERE script_id = :scriptId
`;

export const UPDATE_STATUS = `
  UPDATE master_scripts
     SET status     = :status,
         updated_at = SYSTIMESTAMP
   WHERE script_id = :scriptId
`;

export const LIST_EPISODES_BY_SCRIPT = `
  SELECT ep_id, ep_number, title, status, created_at
    FROM episodes
   WHERE script_id = :scriptId
   ORDER BY ep_number ASC
`;

// ─── 타입 정의 ──────────────────────────────────────────

export interface MasterScriptRow {
  SCRIPT_ID: number;
  TITLE: string;
  GENRE: string | null;
  SYNOPSIS: string | null;
  WORLD_SETTING: string | null;
  STATUS: string;
  CREATED_AT: Date;
  UPDATED_AT: Date;
}

export interface ScriptEpisodeRow {
  EP_ID: number;
  EP_NUMBER: number;
  TITLE: string | null;
  STATUS: string;
  CREATED_AT: Date;
}

interface MasterScriptInsertData {
  title: string;
  genre: string | null;
  synopsis: string | null;
  worldSetting: string | null;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

export async function listMasterScripts(
  conn: oracledb.Connection,
): Promise<MasterScriptRow[]> {
  const result = await conn.execute<MasterScriptRow>(LIST_ALL, {}, OBJ);
  logger.debug('마스터 대본 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function findMasterScriptById(
  conn: oracledb.Connection,
  scriptId: number,
): Promise<MasterScriptRow | undefined> {
  const result = await conn.execute<MasterScriptRow>(FIND_BY_ID, { scriptId }, OBJ);
  return result.rows?.[0];
}

export async function insertMasterScript(
  conn: oracledb.Connection,
  data: MasterScriptInsertData,
  autoCommit = true,
): Promise<number> {
  const bindVars = {
    ...data,
    scriptId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT, bindVars, { autoCommit });
  const newId = (result.outBinds as { scriptId: number[] }).scriptId[0];
  logger.info('마스터 대본 생성', { scriptId: newId, title: data.title });
  return newId;
}

export async function updateMasterScript(
  conn: oracledb.Connection,
  scriptId: number,
  data: MasterScriptInsertData,
): Promise<void> {
  await conn.execute(UPDATE, { scriptId, ...data }, { autoCommit: true });
  logger.info('마스터 대본 수정', { scriptId });
}

export async function updateMasterScriptStatus(
  conn: oracledb.Connection,
  scriptId: number,
  status: string,
): Promise<void> {
  await conn.execute(UPDATE_STATUS, { scriptId, status }, { autoCommit: true });
  logger.info('마스터 대본 상태 변경', { scriptId, status });
}

export async function listEpisodesByScript(
  conn: oracledb.Connection,
  scriptId: number,
): Promise<ScriptEpisodeRow[]> {
  const result = await conn.execute<ScriptEpisodeRow>(
    LIST_EPISODES_BY_SCRIPT,
    { scriptId },
    OBJ,
  );
  return result.rows ?? [];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/db/queries/master-script-queries.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/master-script-queries.ts
git commit -m "feat: add master-script DB queries"
```

---

### Task 3: Master Script Types + Service

**Files:**
- Create: `src/master-scripts/types/master-script.types.ts`
- Create: `src/master-scripts/services/master-script-service.ts`

- [ ] **Step 1: Create types**

Create `src/master-scripts/types/master-script.types.ts`:

```typescript
/**
 * @module 마스터 대본 타입
 * @description 마스터 대본 도메인 타입 정의.
 *
 * @author AI Video Factory
 */

export type MasterScriptStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface CreateMasterScriptRequest {
  readonly title: string;
  readonly genre?: string;
  readonly synopsis?: string;
  readonly worldSetting?: string;
}

export interface UpdateMasterScriptRequest {
  readonly title: string;
  readonly genre?: string;
  readonly synopsis?: string;
  readonly worldSetting?: string;
}

export interface MasterScriptDetail {
  readonly scriptId: number;
  readonly title: string;
  readonly genre: string | null;
  readonly synopsis: string | null;
  readonly worldSetting: string | null;
  readonly status: MasterScriptStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly episodes: Array<{
    epId: number;
    epNumber: number;
    title: string | null;
    status: string;
  }>;
}

export interface MasterScriptSummary {
  readonly scriptId: number;
  readonly title: string;
  readonly genre: string | null;
  readonly status: MasterScriptStatus;
  readonly createdAt: Date;
}
```

- [ ] **Step 2: Create service**

Create `src/master-scripts/services/master-script-service.ts`:

```typescript
/**
 * @module 마스터 대본 서비스
 * @description 마스터 대본 CRUD 비즈니스 로직.
 *
 * ┌──────────┐     ┌────────────────────────┐     ┌──────────┐
 * │  Routes  │ ──→ │ master-script-service   │ ──→ │ Oracle   │
 * │  (HTTP)  │     │ (비즈니스 로직)          │     │ 26ai DB  │
 * └──────────┘     └────────────────────────┘     └──────────┘
 *
 * @dependencies master-script-queries, oracledb
 * @author AI Video Factory
 */

import { getConnection } from '../../db/connection';
import {
  insertMasterScript,
  findMasterScriptById,
  listMasterScripts as listQuery,
  updateMasterScript as updateQuery,
  listEpisodesByScript,
} from '../../db/queries/master-script-queries';
import { logger } from '../../common/logger';
import type {
  CreateMasterScriptRequest,
  UpdateMasterScriptRequest,
  MasterScriptDetail,
  MasterScriptSummary,
  MasterScriptStatus,
} from '../types/master-script.types';

export async function createMasterScript(
  req: CreateMasterScriptRequest,
): Promise<{ scriptId: number }> {
  const conn = await getConnection();
  try {
    const scriptId = await insertMasterScript(conn, {
      title: req.title,
      genre: req.genre ?? null,
      synopsis: req.synopsis ?? null,
      worldSetting: req.worldSetting ?? null,
    });
    return { scriptId };
  } finally {
    await conn.close();
  }
}

export async function getMasterScriptDetail(
  scriptId: number,
): Promise<MasterScriptDetail> {
  const conn = await getConnection();
  try {
    const row = await findMasterScriptById(conn, scriptId);
    if (!row) throw new Error(`마스터 대본을 찾을 수 없습니다: ${scriptId}`);

    const epRows = await listEpisodesByScript(conn, scriptId);

    return {
      scriptId: row.SCRIPT_ID,
      title: row.TITLE,
      genre: row.GENRE,
      synopsis: row.SYNOPSIS,
      worldSetting: row.WORLD_SETTING,
      status: row.STATUS as MasterScriptStatus,
      createdAt: row.CREATED_AT,
      updatedAt: row.UPDATED_AT,
      episodes: epRows.map((e) => ({
        epId: e.EP_ID,
        epNumber: e.EP_NUMBER,
        title: e.TITLE,
        status: e.STATUS,
      })),
    };
  } finally {
    await conn.close();
  }
}

export async function listMasterScripts(): Promise<MasterScriptSummary[]> {
  const conn = await getConnection();
  try {
    const rows = await listQuery(conn);
    return rows.map((r) => ({
      scriptId: r.SCRIPT_ID,
      title: r.TITLE,
      genre: r.GENRE,
      status: r.STATUS as MasterScriptStatus,
      createdAt: r.CREATED_AT,
    }));
  } finally {
    await conn.close();
  }
}

export async function updateMasterScript(
  scriptId: number,
  req: UpdateMasterScriptRequest,
): Promise<void> {
  const conn = await getConnection();
  try {
    const row = await findMasterScriptById(conn, scriptId);
    if (!row) throw new Error(`마스터 대본을 찾을 수 없습니다: ${scriptId}`);
    await updateQuery(conn, scriptId, {
      title: req.title,
      genre: req.genre ?? null,
      synopsis: req.synopsis ?? null,
      worldSetting: req.worldSetting ?? null,
    });
  } finally {
    await conn.close();
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/master-scripts/types/master-script.types.ts src/master-scripts/services/master-script-service.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/master-scripts/
git commit -m "feat: add master-script types and service"
```

---

### Task 4: Master Script Routes + App Registration

**Files:**
- Create: `src/master-scripts/routes/master-script-routes.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Create routes**

Create `src/master-scripts/routes/master-script-routes.ts`:

```typescript
/**
 * @module 마스터 대본 API 라우터
 * @description 마스터 대본 CRUD API.
 *
 * ┌──────────┐     ┌────────────────────┐     ┌────────────────────────┐
 * │  Client  │ ──→ │ master-script      │ ──→ │ master-script-service  │
 * │  (API)   │     │ routes             │     │ (비즈니스 로직)          │
 * └──────────┘     └────────────────────┘     └────────────────────────┘
 *
 * @dependencies express, master-script-service
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  createMasterScript,
  getMasterScriptDetail,
  listMasterScripts,
  updateMasterScript,
} from '../services/master-script-service';
import { logger } from '../../common/logger';
import type { CreateMasterScriptRequest } from '../types/master-script.types';

const router = Router();

// ─── 목록 ───────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const data = await listMasterScripts();
    res.json({ success: true, data });
  }),
);

// ─── 생성 ───────────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateMasterScriptRequest;
    if (!body.title) {
      res.status(400).json({ success: false, error: 'title은 필수입니다' });
      return;
    }
    const result = await createMasterScript(body);
    logger.info('마스터 대본 생성 API', { scriptId: result.scriptId });
    res.json({ success: true, ...result });
  }),
);

// ─── 상세 ───────────────────────────────────────────────

router.get(
  '/:scriptId',
  asyncHandler(async (req: Request, res: Response) => {
    const scriptId = Number(req.params.scriptId);
    try {
      const data = await getMasterScriptDetail(scriptId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('찾을 수 없습니다')) {
        res.status(404).json({ success: false, error: msg });
        return;
      }
      throw err;
    }
  }),
);

// ─── 수정 ───────────────────────────────────────────────

router.put(
  '/:scriptId',
  asyncHandler(async (req: Request, res: Response) => {
    const scriptId = Number(req.params.scriptId);
    const body = req.body as Record<string, unknown>;
    await updateMasterScript(scriptId, {
      title: (body.title as string) ?? '',
      genre: (body.genre as string) ?? undefined,
      synopsis: (body.synopsis as string) ?? undefined,
      worldSetting: (body.worldSetting as string) ?? undefined,
    });
    res.json({ success: true });
  }),
);

export default router;
```

- [ ] **Step 2: Register in app.ts**

Add import after existing imports:

```typescript
import masterScriptRoutes from './master-scripts/routes/master-script-routes';
```

Add route registration after existing routes:

```typescript
app.use('/api/master-scripts', masterScriptRoutes);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/master-scripts/routes/master-script-routes.ts src/app.ts
git commit -m "feat: add master-script REST API routes"
```

---

### Task 5: Episode scriptId Support

**Files:**
- Modify: `src/db/queries/episode-queries.ts`
- Modify: `src/episodes/types/episode.types.ts`
- Modify: `src/episodes/services/episode-service.ts`
- Modify: `src/episodes/routes/episode-routes.ts`

- [ ] **Step 1: Update episode queries**

In `src/db/queries/episode-queries.ts`:

Update `INSERT` SQL to include `script_id`:

```sql
INSERT INTO episodes
  (ep_number, title, synopsis, ep_type, script_json,
   world_state, decision_reasoning, script_id)
VALUES
  (:epNumber, :title, :synopsis, :epType, :scriptJson,
   :worldState, :decisionReasoning, :scriptId)
RETURNING ep_id INTO :epId
```

Update `LIST_ALL` and `FIND_BY_ID` SQL to include `script_id` in SELECT.

Add `LIST_BY_SCRIPT` SQL constant:

```typescript
export const LIST_BY_SCRIPT = `
  SELECT ep_id, ep_number, title, synopsis, ep_type,
         status, script_id, created_at, approved_at, published_at
    FROM episodes
   WHERE script_id = :scriptId
   ORDER BY ep_number DESC
`;
```

Update `EpisodeRow` to include `SCRIPT_ID: number | null`.

Update `EpisodeInsertData` to include `scriptId: number | null`.

Add `listEpisodesByScript` function following existing `listEpisodes` pattern.

- [ ] **Step 2: Update episode types**

In `src/episodes/types/episode.types.ts`:

Add `scriptId?: number` to `CreateEpisodeRequest`.
Add `scriptId: number | null` to `EpisodeDetail`.

- [ ] **Step 3: Update episode service**

In `src/episodes/services/episode-service.ts`:

Update `createEpisode` to pass `scriptId: req.scriptId ?? null` to `insertEpisode`.
Update `getEpisodeDetail` to include `scriptId: ep.SCRIPT_ID` in return.

- [ ] **Step 4: Update episode routes**

In `src/episodes/routes/episode-routes.ts`:

Import `listEpisodesByScript` from queries. Update GET `/` to check `req.query.scriptId` and call the filtered query when present.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/episode-queries.ts src/episodes/types/episode.types.ts src/episodes/services/episode-service.ts src/episodes/routes/episode-routes.ts
git commit -m "feat: add scriptId support to episodes"
```

---

### Task 6: MCP Server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools/master-script.ts`
- Create: `src/mcp/tools/episode.ts`
- Create: `src/mcp/tools/resource.ts`

- [ ] **Step 1: Install MCP SDK**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Create MCP tool — master-script**

Create `src/mcp/tools/master-script.ts` with two tools:

- `create_master_script` — POST /api/master-scripts with { title, genre?, synopsis?, worldSetting? }
- `get_master_script` — GET /api/master-scripts/:scriptId

Each tool uses `fetch()` to call the REST API and returns JSON result as text content.

Use `z` (zod, bundled with MCP SDK) for parameter schemas. Use `McpServer.tool()` method.

See spec `docs/superpowers/specs/2026-03-30-script-driven-episode-pipeline-design.md` for exact parameter schemas.

- [ ] **Step 3: Create MCP tool — episode**

Create `src/mcp/tools/episode.ts` with two tools:

- `create_episode_with_scenes` — POST /api/episodes with full scene data
- `get_episode_detail` — GET /api/episodes/:epId

Scene input schema should include nested `script` object with `dialogues` array.

- [ ] **Step 4: Create MCP tool — resource**

Create `src/mcp/tools/resource.ts` with two tools:

- `list_characters` — GET /api/characters (no params)
- `list_locations` — GET /api/locations (no params)

- [ ] **Step 5: Create MCP server entry point**

Create `src/mcp/server.ts`:

```typescript
/**
 * @module MCP 서버 진입점
 * @description VideoFactory MCP 서버. Claude CLI가 대본/에피소드/리소스를 관리하는 도구 제공.
 *
 * ┌────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Claude CLI │ ──→ │ MCP Server   │ ──→ │ REST API     │
 * │ (stdio)    │     │ (도구 등록)   │     │ (:3000)      │
 * └────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies @modelcontextprotocol/sdk
 * @author AI Video Factory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMasterScriptTools } from './tools/master-script.js';
import { registerEpisodeTools } from './tools/episode.js';
import { registerResourceTools } from './tools/resource.js';

const server = new McpServer({
  name: 'videofactory',
  version: '1.0.0',
});

registerMasterScriptTools(server);
registerEpisodeTools(server);
registerResourceTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/mcp/server.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/mcp/ package.json package-lock.json
git commit -m "feat: add MCP server with master-script, episode, and resource tools"
```

---

### Task 7: MCP Server Configuration

**Files:**
- Create or modify: `.claude/settings.json`

- [ ] **Step 1: Create Claude settings with MCP server config**

Create or merge into `.claude/settings.json`:

```json
{
  "mcpServers": {
    "videofactory": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "C:\\VideoFactory",
      "env": {
        "API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

- [ ] **Step 2: Test MCP server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | npx tsx src/mcp/server.ts
```

Expected: JSON response with server capabilities and tool list.

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat: add MCP server configuration for Claude CLI"
```

---

### Task 8: Web UI — Master Script Pages + Episode Filter

**Files:**
- Create: `src/web/views/scripts/list.ejs`
- Create: `src/web/views/scripts/detail.ejs`
- Modify: `src/web/routes/web-routes.ts`
- Modify: `src/web/views/sidebar.ejs`
- Modify: `src/web/views/episodes/list.ejs`

- [ ] **Step 1: Add web routes**

In `src/web/routes/web-routes.ts`, add after the episodes section:

```typescript
// ─── 마스터 대본 ───────────────────────────────────────────

router.get('/scripts', (_req: Request, res: Response) => {
  res.render('scripts/list', { title: '마스터 대본' });
});

router.get('/scripts/:scriptId', (req: Request, res: Response) => {
  res.render('scripts/detail', { title: '대본 상세', scriptId: req.params.scriptId });
});
```

- [ ] **Step 2: Create scripts list page**

Create `src/web/views/scripts/list.ejs` with:
- Header "마스터 대본"
- Loading spinner
- Card grid populated via `fetch('/api/master-scripts')`
- Each card links to `/scripts/:scriptId`
- Empty state message: "등록된 대본이 없습니다. Claude CLI로 생성하세요."
- Build all DOM elements using `document.createElement()` and `textContent` (no innerHTML)

- [ ] **Step 3: Create scripts detail page**

Create `src/web/views/scripts/detail.ejs` with:
- Back link to `/scripts`
- Title, genre, status badge, synopsis, world setting display
- Episode list (each links to `/episodes/:epId/edit`)
- Load via `fetch('/api/master-scripts/<%= scriptId %>')`
- All DOM built with `createElement` / `textContent`

- [ ] **Step 4: Add sidebar link**

Read `src/web/views/sidebar.ejs` and add a "마스터 대본" link matching existing sidebar pattern, linking to `/scripts`.

- [ ] **Step 5: Add script filter to episode list**

In `src/web/views/episodes/list.ejs`:
- Add `<select id="script-filter">` dropdown after the status filter tabs
- Load master scripts via `fetch('/api/master-scripts')` into dropdown options
- On change, re-fetch episodes with `?scriptId=` query param
- Build option elements with `createElement` / `textContent`

- [ ] **Step 6: Verify pages render**

Start dev server, check:
- `http://localhost:3000/scripts` loads
- `http://localhost:3000/episodes` shows script filter dropdown

- [ ] **Step 7: Commit**

```bash
git add src/web/views/scripts/ src/web/routes/web-routes.ts src/web/views/sidebar.ejs src/web/views/episodes/list.ejs
git commit -m "feat: add master script web UI and episode filter"
```

---

### Task 9: Integration Test

- [ ] **Step 1: Start the Express server**

```bash
npm run dev
```

- [ ] **Step 2: Test master script API**

```bash
curl -X POST http://localhost:3000/api/master-scripts -H "Content-Type: application/json" -d "{\"title\":\"이세계 유튜버 한소율\",\"genre\":\"코미디/판타지\",\"synopsis\":\"고등학생 유튜버가 이세계에서 모험하는 이야기\"}"
```

Expected: `{"success":true,"scriptId":1}`

- [ ] **Step 3: Test episode creation with scriptId**

```bash
curl -X POST http://localhost:3000/api/episodes -H "Content-Type: application/json" -d "{\"scriptId\":1,\"epNumber\":1,\"title\":\"시작은 언제나 갑작스럽게\",\"scenes\":[{\"sceneOrder\":1,\"description\":\"소율이 방에서 영상 촬영 중\",\"emotion\":\"surprised\"}]}"
```

Expected: `{"success":true,"epId":...,"sceneCount":1,"status":"draft"}`

- [ ] **Step 4: Test master script detail**

```bash
curl http://localhost:3000/api/master-scripts/1
```

Expected: JSON with `episodes` array containing the episode from step 3.

- [ ] **Step 5: Test episode list with scriptId filter**

```bash
curl "http://localhost:3000/api/episodes/?scriptId=1"
```

Expected: Only episodes belonging to scriptId 1.

- [ ] **Step 6: Test MCP server initialization**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | npx tsx src/mcp/server.ts
```

Expected: JSON response listing all 6 tools.

- [ ] **Step 7: Verify web UI pages**

Open in browser:
- `http://localhost:3000/scripts` — master script list
- `http://localhost:3000/episodes` — list with script filter dropdown
