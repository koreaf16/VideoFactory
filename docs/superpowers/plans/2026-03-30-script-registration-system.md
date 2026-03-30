# Script Registration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude CLI에서 생성한 대본을 캐릭터/장소 개별 등록 후 에피소드+씬 일괄 등록하는 API 구현, 웹 UI에서 조회/수정/승인 가능.

**Architecture:** 기존 `episodes`/`scenes` 테이블 활용 + `scene_characters` 조인 테이블 추가. `episode-service.ts`에서 트랜잭션 처리. 기존 스텁 라우트를 실제 구현으로 교체. 웹 UI는 기존 EJS 템플릿의 정적 HTML을 동적 JS로 교체.

**Tech Stack:** TypeScript, Express, Oracle 26ai (oracledb), EJS, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-30-script-registration-system-design.md`

**XSS Note:** 웹 UI의 동적 HTML 생성 시, DB에서 온 데이터도 textContent 또는 DOM API를 사용하여 안전하게 렌더링. innerHTML은 정적 구조에만 사용하고, 사용자/DB 데이터는 반드시 textContent로 삽입.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/db/schema.sql` | scene_characters DDL 추가 |
| Modify | `src/db/queries/scene-queries.ts` | scene_characters 쿼리 + UPDATE_SCENE + 전체 SceneRow 타입 |
| Modify | `src/db/queries/episode-queries.ts` | UPDATE_EPISODE + FIND_BY_EP_NUMBER 추가 |
| Modify | `src/episodes/types/episode.types.ts` | Scene에 characters 필드, 요청 타입 추가 |
| Create | `src/episodes/services/episode-service.ts` | createEpisode, getEpisodeDetail, updateEpisode, updateScene, approveEpisode |
| Modify | `src/episodes/routes/episode-routes.ts` | 스텁을 실제 핸들러로 교체 |
| Modify | `src/web/views/episodes/list.ejs` | 정적 HTML을 동적 API 연동 JS로 교체 |
| Modify | `src/web/views/episodes/editor.ejs` | 정적 HTML을 동적 API 연동 JS로 교체 |
| Modify | `src/web/routes/web-routes.ts` | epId를 에디터 뷰에 전달 |

---

### Task 1: DB Schema + scene_characters 쿼리

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/queries/scene-queries.ts`

- [ ] **Step 1: schema.sql에 scene_characters 테이블 추가**

scenes 테이블 정의 이후에 추가:

```sql
-- -----------------------------------------------------------
-- scene_characters — 씬별 출연 캐릭터
-- -----------------------------------------------------------
CREATE TABLE scene_characters (
  scene_id    NUMBER       REFERENCES scenes(scene_id) ON DELETE CASCADE,
  char_id     VARCHAR2(50) REFERENCES characters(char_id),
  PRIMARY KEY (scene_id, char_id)
);
```

- [ ] **Step 2: scene-queries.ts에 SQL 상수 추가**

기존 SQL 상수 영역에 추가:

```typescript
export const INSERT_SCENE_CHARACTER = `
  INSERT INTO scene_characters (scene_id, char_id)
  VALUES (:sceneId, :charId)
`;

export const FIND_CHARACTERS_BY_SCENE = `
  SELECT sc.char_id, c.name
    FROM scene_characters sc
    JOIN characters c ON c.char_id = sc.char_id
   WHERE sc.scene_id = :sceneId
`;

export const UPDATE_SCENE = `
  UPDATE scenes
     SET description   = :description,
         script        = :script,
         prompt_en     = :promptEn,
         motion_prompt = :motionPrompt
   WHERE scene_id = :sceneId
`;
```

- [ ] **Step 3: SceneRow를 전체 컬럼으로 보강**

기존 SceneRow 인터페이스를 교체:

```typescript
interface SceneRow {
  SCENE_ID: number;
  EP_ID: number;
  SCENE_ORDER: number;
  DESCRIPTION: string | null;
  LOCATION_ID: string | null;
  TIME_OF_DAY: string | null;
  CAMERA_TYPE: string | null;
  EMOTION: string | null;
  DURATION_SEC: number | null;
  SCRIPT: string | null;
  PROMPT_EN: string | null;
  MOTION_PROMPT: string | null;
  STATUS: string;
  KEYFRAME_PATH: string | null;
  VIDEO_PATH: string | null;
  UPSCALED_PATH: string | null;
  TTS_PATH: string | null;
  QUALITY_SCORE: number | null;
  CREATED_AT: Date;
}
```

- [ ] **Step 4: 쿼리 함수 추가 + insertScene에 autoCommit 파라미터 추가**

SceneCharacterRow 타입 export + 쿼리 함수:

```typescript
export interface SceneCharacterRow {
  CHAR_ID: string;
  NAME: string;
}

export async function insertSceneCharacter(
  conn: oracledb.Connection,
  sceneId: number,
  charId: string,
  autoCommit = true,
): Promise<void> {
  await conn.execute(INSERT_SCENE_CHARACTER, { sceneId, charId }, { autoCommit });
}

export async function findCharactersByScene(
  conn: oracledb.Connection,
  sceneId: number,
): Promise<SceneCharacterRow[]> {
  const result = await conn.execute<SceneCharacterRow>(
    FIND_CHARACTERS_BY_SCENE, { sceneId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows ?? [];
}

export async function updateScene(
  conn: oracledb.Connection,
  sceneId: number,
  data: { description: string | null; script: string | null; promptEn: string | null; motionPrompt: string | null },
): Promise<void> {
  await conn.execute(UPDATE_SCENE, { sceneId, ...data }, { autoCommit: true });
  logger.info('씬 수정', { sceneId });
}
```

기존 `insertScene` 함수 시그니처에 `autoCommit = true` 파라미터 추가:

```typescript
export async function insertScene(
  conn: oracledb.Connection,
  data: SceneInsertData,
  autoCommit = true,
): Promise<number> {
  // 기존 본문 동일, { autoCommit } 로 변경
}
```

- [ ] **Step 5: 커밋**

```bash
git add src/db/schema.sql src/db/queries/scene-queries.ts
git commit -m "feat: add scene_characters table and scene queries"
```

---

### Task 2: episode-queries.ts 업데이트

**Files:**
- Modify: `src/db/queries/episode-queries.ts`

- [ ] **Step 1: SQL 상수 추가**

```typescript
export const UPDATE_EPISODE = `
  UPDATE episodes
     SET title              = :title,
         synopsis           = :synopsis,
         decision_reasoning = :decisionReasoning
   WHERE ep_id = :epId
`;

export const FIND_BY_EP_NUMBER = `
  SELECT ep_id FROM episodes WHERE ep_number = :epNumber
`;
```

- [ ] **Step 2: insertEpisode에 autoCommit 파라미터 추가**

```typescript
export async function insertEpisode(
  conn: oracledb.Connection,
  data: EpisodeInsertData,
  autoCommit = true,
): Promise<number> {
  const bindVars = {
    ...data,
    epId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT, bindVars, { autoCommit });
  const newId = (result.outBinds as { epId: number[] }).epId[0];
  logger.info('에피소드 생성', { epId: newId, epNumber: data.epNumber });
  return newId;
}
```

- [ ] **Step 3: 쿼리 함수 추가**

```typescript
export async function updateEpisode(
  conn: oracledb.Connection,
  epId: number,
  data: { title: string | null; synopsis: string | null; decisionReasoning: string | null },
): Promise<void> {
  await conn.execute(UPDATE_EPISODE, { epId, ...data }, { autoCommit: true });
  logger.info('에피소드 수정', { epId });
}

export async function findByEpNumber(
  conn: oracledb.Connection,
  epNumber: number,
): Promise<boolean> {
  const result = await conn.execute<{ EP_ID: number }>(
    FIND_BY_EP_NUMBER, { epNumber }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return (result.rows?.length ?? 0) > 0;
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/db/queries/episode-queries.ts
git commit -m "feat: add episode update and duplicate check queries"
```

---

### Task 3: episode.types.ts 업데이트

**Files:**
- Modify: `src/episodes/types/episode.types.ts`

- [ ] **Step 1: Scene에 characters 추가 + 요청 타입 추가**

Scene 인터페이스에 `characters` 필드 추가 (promptEn 앞):

```typescript
readonly characters?: Array<{ charId: string; name: string }>;
```

파일 하단에 요청 타입 추가:

```typescript
export interface CreateSceneInput {
  readonly sceneOrder: number;
  readonly description?: string;
  readonly locationId?: string;
  readonly characters?: string[];
  readonly timeOfDay?: string;
  readonly cameraType?: string;
  readonly emotion?: string;
  readonly durationSec?: number;
  readonly script?: SceneScript;
  readonly promptEn?: string;
  readonly motionPrompt?: string;
}

export interface CreateEpisodeRequest {
  readonly epNumber: number;
  readonly title: string;
  readonly synopsis?: string;
  readonly epType?: string;
  readonly decisionReasoning?: string;
  readonly scenes: CreateSceneInput[];
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/episodes/types/episode.types.ts
git commit -m "feat: add episode creation request types"
```

---

### Task 4: episode-service.ts 생성

**Files:**
- Create: `src/episodes/services/episode-service.ts`

- [ ] **Step 1: 서비스 파일 생성**

모듈 상단 주석 + import + createEpisode + getEpisodeDetail + updateEpisode + updateScene + approveEpisode 함수.

`createEpisode`는 트랜잭션:
1. `findByEpNumber`로 중복 체크
2. `insertEpisode(conn, data, false)` — autoCommit: false
3. 각 씬: `insertScene(conn, sceneData, false)` → sceneId 반환
4. 각 씬의 characters: `insertSceneCharacter(conn, sceneId, charId, false)`
5. `conn.commit()` (에러 시 `conn.rollback()`)

`getEpisodeDetail`은:
1. `findEpisodeById` → 에피소드 기본 정보
2. `findScenesByEpisode` → 씬 목록
3. 각 씬마다 `findCharactersByScene` → 출연 캐릭터
4. SCRIPT 필드는 JSON.parse로 파싱

`updateEpisode`: title, synopsis, decisionReasoning 수정
`updateScene`: description, script, promptEn, motionPrompt 수정
`approveEpisode`: status 체크 후 승인

전체 코드는 스펙의 service layer 섹션 참조. 200줄 이내 유지.

- [ ] **Step 2: 커밋**

```bash
git add src/episodes/services/episode-service.ts
git commit -m "feat: implement episode service with transaction support"
```

---

### Task 5: episode-routes.ts 스텁 교체

**Files:**
- Modify: `src/episodes/routes/episode-routes.ts`

- [ ] **Step 1: 전체 파일을 실제 구현으로 교체**

`notImplemented` 스텁을 모두 제거하고 실제 핸들러로 교체:

| 기존 스텁 | 교체 엔드포인트 | 핸들러 |
|-----------|----------------|--------|
| `POST /generate` | `POST /` | `createEpisode` |
| `GET /:epId` | `GET /:epId` | `getEpisodeDetail` |
| `PUT /:epId` | `PUT /:epId` | `updateEpisode` |
| `PUT /:epId/scenes/:sceneId` | 유지 | `updateScene` |
| `POST /:epId/approve` | 유지 | `approveEpisode` |
| `POST /:epId/scenes/:sceneId/regenerate` | 제거 (out of scope) | - |

추가: `GET /` — `listEpisodes` (에피소드 목록)

import: `asyncHandler`, `getConnection`, `listEpisodes`, 서비스 함수들, `logger`, `CreateEpisodeRequest` 타입.

각 핸들러는 요청 파싱 → 서비스 호출 → JSON 응답. 에러는 asyncHandler가 처리.

- [ ] **Step 2: 커밋**

```bash
git add src/episodes/routes/episode-routes.ts
git commit -m "feat: implement episode API endpoints"
```

---

### Task 6: 에피소드 목록 UI 동적 연동

**Files:**
- Modify: `src/web/views/episodes/list.ejs`

- [ ] **Step 1: 정적 테이블을 동적으로 교체**

변경 사항:
1. 필터 버튼에 `data-filter` 속성 추가 (`all`, `draft`, `approved`, `generating`, `completed`)
2. `<tbody>` 안의 정적 행 제거 → 빈 `<tbody id="ep-tbody">`
3. 하단에 `<script>` 블록 추가:
   - `GET /api/episodes/` 호출
   - 상태별 필터링
   - 동적 행 생성 (DOM API로 안전하게 — textContent 사용)
   - 행 클릭 → `/episodes/:epId/edit` 이동

- [ ] **Step 2: 커밋**

```bash
git add src/web/views/episodes/list.ejs
git commit -m "feat: dynamic episode list with API and status filter"
```

---

### Task 7: 에피소드 에디터 UI 동적 연동

**Files:**
- Modify: `src/web/views/episodes/editor.ejs`
- Modify: `src/web/routes/web-routes.ts`

- [ ] **Step 1: web-routes.ts에서 epId를 뷰에 전달**

```typescript
router.get('/episodes/:epId/edit', (req: Request, res: Response) => {
  res.render('episodes/editor', { title: '대본 편집', epId: req.params.epId });
});
```

- [ ] **Step 2: editor.ejs 동적 렌더링으로 교체**

변경 사항:
1. 정적 씬 카드 3개 제거 → 빈 `<div id="scene-list">`
2. 에피소드 메타 (제목/시놉시스) 입력란에 id 부여 + "저장" 버튼 추가
3. 상태 뱃지 동적 업데이트
4. 승인 버튼은 draft/review 상태일 때만 표시
5. `<script>` 블록:
   - `GET /api/episodes/<%= epId %>` 호출
   - 씬 카드 동적 생성 (DOM API — textContent로 대사/프롬프트 삽입)
   - 메타 저장: `PUT /api/episodes/<%= epId %>`
   - 승인: `POST /api/episodes/<%= epId %>/approve`

- [ ] **Step 3: 커밋**

```bash
git add src/web/views/episodes/editor.ejs src/web/routes/web-routes.ts
git commit -m "feat: dynamic episode editor with API integration"
```

---

### Task 8: Oracle DB DDL 실행

**Files:** None (DB only)

- [ ] **Step 1: scene_characters 테이블 생성**

```sql
CREATE TABLE scene_characters (
  scene_id    NUMBER       REFERENCES scenes(scene_id) ON DELETE CASCADE,
  char_id     VARCHAR2(50) REFERENCES characters(char_id),
  PRIMARY KEY (scene_id, char_id)
);
```

- [ ] **Step 2: characters에 prompt_base 컬럼 추가** (이전 작업분)

```sql
ALTER TABLE characters ADD prompt_base VARCHAR2(2000);
```

- [ ] **Step 3: 확인**

```sql
SELECT table_name FROM user_tables WHERE table_name = 'SCENE_CHARACTERS';
SELECT column_name FROM user_tab_columns WHERE table_name = 'CHARACTERS' AND column_name = 'PROMPT_BASE';
```
