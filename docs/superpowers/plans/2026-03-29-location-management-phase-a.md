# 장소 관리 Phase A: 기반 인프라 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 CRUD API, 관리 페이지, 사이드바 메뉴, 후보 생성 테이블을 구축하여 장소 파이프라인의 기반을 만든다.

**Architecture:** `locations` 테이블(이미 존재)에 대한 쿼리 모듈과 CRUD 라우트를 만들고, 캐릭터 manage.ejs 패턴을 따라 장소 관리 페이지를 생성한다. `location_candidates` 테이블은 `char_candidates`와 동일한 구조로 새로 생성한다.

**Tech Stack:** Express, EJS, Oracle 26ai, oracledb

---

## 파일 구조

```
src/db/queries/
  location-queries.ts         — locations + location_candidates SQL 쿼리
src/locations/
  routes/
    location-routes.ts        — CRUD + 후보 생성/조회 API
  types/
    location.types.ts         — 장소 도메인 타입
src/web/views/locations/
  manage.ejs                  — 장소 목록/등록 페이지
src/web/views/sidebar.ejs     — 장소 관리 메뉴 추가
src/web/routes/web-routes.ts  — 장소 페이지 라우트 추가
src/app.ts                    — 장소 API 라우트 마운트
scripts/create-location-candidates.sql — DDL 스크립트
```

---

### Task 1: location_candidates 테이블 생성

**Files:**
- Create: `scripts/create-location-candidates.sql`

- [ ] **Step 1: DDL 스크립트 작성**

```sql
-- location_candidates — 장소 배경 후보 이미지
CREATE TABLE location_candidates (
  candidate_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id       VARCHAR2(50)    REFERENCES locations(location_id),
  job_id            VARCHAR2(100),
  image_path        VARCHAR2(500)   NOT NULL,
  prompt_text       VARCHAR2(2000),
  seed              NUMBER,
  quality_score     NUMBER(4,3),
  liked             NUMBER(1)       DEFAULT 0,
  is_anchor         NUMBER(1)       DEFAULT 0,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);
```

- [ ] **Step 2: DB에 테이블 생성 실행**

```bash
npx tsx -e "
import { initPool, getConnection, closePool } from './src/db/connection';
(async () => {
  await initPool();
  const conn = await getConnection();
  try {
    await conn.execute(\`
      CREATE TABLE location_candidates (
        candidate_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        location_id       VARCHAR2(50)    REFERENCES locations(location_id),
        job_id            VARCHAR2(100),
        image_path        VARCHAR2(500)   NOT NULL,
        prompt_text       VARCHAR2(2000),
        seed              NUMBER,
        quality_score     NUMBER(4,3),
        liked             NUMBER(1)       DEFAULT 0,
        is_anchor         NUMBER(1)       DEFAULT 0,
        created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
      )
    \`);
    await conn.commit();
    console.log('location_candidates 테이블 생성 완료');
  } finally {
    await conn.close();
    await closePool();
  }
})();
"
```

- [ ] **Step 3: schema.sql에 테이블 정의 추가 (문서화)**

`src/db/schema.sql`의 `location_ref_images` 테이블 바로 뒤에 추가:

```sql
-- -----------------------------------------------------------
-- 5-b. location_candidates — 장소 배경 후보 이미지
-- -----------------------------------------------------------
CREATE TABLE location_candidates (
  candidate_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id       VARCHAR2(50)    REFERENCES locations(location_id),
  job_id            VARCHAR2(100),
  image_path        VARCHAR2(500)   NOT NULL,
  prompt_text       VARCHAR2(2000),
  seed              NUMBER,
  quality_score     NUMBER(4,3),
  liked             NUMBER(1)       DEFAULT 0,
  is_anchor         NUMBER(1)       DEFAULT 0,
  created_at        TIMESTAMP       DEFAULT SYSTIMESTAMP
);
```

- [ ] **Step 4: Commit**

```bash
git add scripts/create-location-candidates.sql src/db/schema.sql
git commit -m "feat: add location_candidates table DDL"
```

---

### Task 2: 장소 타입 정의

**Files:**
- Create: `src/locations/types/location.types.ts`

- [ ] **Step 1: 타입 파일 생성**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/types/location.types.ts
git commit -m "feat: add location domain types"
```

---

### Task 3: 장소 DB 쿼리 모듈

**Files:**
- Create: `src/db/queries/location-queries.ts`

- [ ] **Step 1: 쿼리 파일 생성**

```typescript
/**
 * @module 장소 쿼리
 * @description locations, location_candidates 테이블 SQL 쿼리.
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const LIST_LOCATIONS = `
  SELECT location_id, name, name_en, region_id, location_type,
         prompt_base, description, first_ep, created_at
    FROM locations
   ORDER BY created_at DESC
`;

export const FIND_LOCATION_BY_ID = `
  SELECT location_id, name, name_en, region_id, location_type,
         prompt_base, description, first_ep, created_at
    FROM locations
   WHERE location_id = :locationId
`;

export const INSERT_LOCATION = `
  INSERT INTO locations
    (location_id, name, name_en, location_type, prompt_base, description)
  VALUES
    (:locationId, :name, :nameEn, :locationType, :promptBase, :description)
`;

export const UPDATE_LOCATION_TYPE = `
  UPDATE locations
     SET location_type = :locationType
   WHERE location_id = :locationId
`;

// ─── 후보 SQL ────────────────────────────────────────────

export const INSERT_LOC_CANDIDATE = `
  INSERT INTO location_candidates
    (location_id, job_id, image_path, prompt_text, seed)
  VALUES
    (:locationId, :jobId, :imagePath, :promptText, :seed)
  RETURNING candidate_id INTO :candidateId
`;

export const LIST_LOC_CANDIDATES_BY_JOB = `
  SELECT candidate_id, location_id, job_id, image_path,
         prompt_text, seed, quality_score, liked, is_anchor, created_at
    FROM location_candidates
   WHERE job_id = :jobId
   ORDER BY candidate_id DESC
`;

export const LATEST_LOC_JOB = `
  SELECT job_id, MAX(created_at) AS last_created
    FROM location_candidates
   WHERE location_id = :locationId
   GROUP BY job_id
   ORDER BY last_created DESC
   FETCH FIRST 1 ROWS ONLY
`;

export const TOGGLE_LOC_LIKE = `
  UPDATE location_candidates
     SET liked = CASE WHEN liked = 1 THEN 0 ELSE 1 END
   WHERE candidate_id = :candidateId
`;

export const GET_LOC_LIKED_STATUS = `
  SELECT liked FROM location_candidates WHERE candidate_id = :candidateId
`;

export const SET_LOC_ANCHOR = `
  UPDATE location_candidates
     SET is_anchor = 1
   WHERE candidate_id = :candidateId
`;

// ─── ref_images SQL ──────────────────────────────────────

export const LIST_LOC_REF_IMAGES = `
  SELECT ref_id, location_id, image_path, angle,
         time_of_day, weather, quality_score, is_anchor, approved, created_at
    FROM location_ref_images
   WHERE location_id = :locationId AND approved = 1
   ORDER BY created_at ASC
`;

export const COUNT_LOC_REF_IMAGES = `
  SELECT COUNT(*) AS CNT
    FROM location_ref_images
   WHERE location_id = :locationId AND approved = 1
`;

export const GET_LOC_ANCHOR_PATH = `
  SELECT image_path
    FROM location_candidates
   WHERE location_id = :locationId AND is_anchor = 1
   FETCH FIRST 1 ROWS ONLY
`;

// ─── 행 타입 ────────────────────────────────────────────

export interface LocationRow {
  LOCATION_ID: string;
  NAME: string;
  NAME_EN: string | null;
  REGION_ID: string | null;
  LOCATION_TYPE: string | null;
  PROMPT_BASE: string | null;
  DESCRIPTION: string | null;
  FIRST_EP: number | null;
  CREATED_AT: Date;
}

export interface LocCandidateRow {
  CANDIDATE_ID: number;
  LOCATION_ID: string;
  JOB_ID: string;
  IMAGE_PATH: string;
  PROMPT_TEXT: string | null;
  SEED: number | null;
  QUALITY_SCORE: number | null;
  LIKED: number;
  IS_ANCHOR: number;
  CREATED_AT: Date;
}

export interface LocRefImageRow {
  REF_ID: number;
  LOCATION_ID: string;
  IMAGE_PATH: string;
  ANGLE: string | null;
  TIME_OF_DAY: string | null;
  WEATHER: string | null;
  QUALITY_SCORE: number | null;
  IS_ANCHOR: number;
  APPROVED: number;
  CREATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

export async function listLocations(
  conn: oracledb.Connection,
): Promise<LocationRow[]> {
  const result = await conn.execute<LocationRow>(
    LIST_LOCATIONS, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('장소 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function findLocationById(
  conn: oracledb.Connection,
  locationId: string,
): Promise<LocationRow | undefined> {
  const result = await conn.execute<LocationRow>(
    FIND_LOCATION_BY_ID, { locationId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0];
}

export async function insertLocation(
  conn: oracledb.Connection,
  data: {
    locationId: string;
    name: string;
    nameEn: string | null;
    locationType: string | null;
    promptBase: string | null;
    description: string | null;
  },
): Promise<void> {
  await conn.execute(INSERT_LOCATION, data as unknown as Record<string, unknown>, { autoCommit: true });
  logger.info('장소 생성', { locationId: data.locationId, name: data.name });
}

export async function insertLocCandidate(
  conn: oracledb.Connection,
  data: {
    locationId: string;
    jobId: string;
    imagePath: string;
    promptText: string;
    seed: number;
  },
): Promise<number> {
  const binds = {
    ...data,
    candidateId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(INSERT_LOC_CANDIDATE, binds as unknown as Record<string, unknown>, { autoCommit: true });
  const outBinds = result.outBinds as unknown as { candidateId: number[] };
  return outBinds.candidateId[0];
}

export async function listLocCandidatesByJob(
  conn: oracledb.Connection,
  jobId: string,
): Promise<LocCandidateRow[]> {
  const result = await conn.execute<LocCandidateRow>(
    LIST_LOC_CANDIDATES_BY_JOB, { jobId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows ?? [];
}

export async function getLatestLocJob(
  conn: oracledb.Connection,
  locationId: string,
): Promise<string | null> {
  const result = await conn.execute<{ JOB_ID: string }>(
    LATEST_LOC_JOB, { locationId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.JOB_ID ?? null;
}

export async function toggleLocCandidateLike(
  conn: oracledb.Connection,
  candidateId: number,
): Promise<number> {
  await conn.execute(TOGGLE_LOC_LIKE, { candidateId }, { autoCommit: true });
  const check = await conn.execute<{ LIKED: number }>(
    GET_LOC_LIKED_STATUS, { candidateId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return check.rows?.[0]?.LIKED ?? 0;
}

export async function setLocAnchorCandidate(
  conn: oracledb.Connection,
  candidateId: number,
): Promise<void> {
  await conn.execute(SET_LOC_ANCHOR, { candidateId }, { autoCommit: true });
  logger.info('장소 앵커 설정', { candidateId });
}

export async function countLocRefImages(
  conn: oracledb.Connection,
  locationId: string,
): Promise<number> {
  const result = await conn.execute<{ CNT: number }>(
    COUNT_LOC_REF_IMAGES, { locationId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.CNT ?? 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/queries/location-queries.ts
git commit -m "feat: add location DB queries module"
```

---

### Task 4: 장소 CRUD 라우트

**Files:**
- Create: `src/locations/routes/location-routes.ts`

- [ ] **Step 1: 라우트 파일 생성**

```typescript
/**
 * @module 장소 API 라우터
 * @description 장소 CRUD, 후보 조회/좋아요/앵커 설정 API.
 *
 * @dependencies express, location-queries, db
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  listLocations,
  findLocationById,
  insertLocation,
  listLocCandidatesByJob,
  getLatestLocJob,
  toggleLocCandidateLike,
  setLocAnchorCandidate,
  countLocRefImages,
} from '../../db/queries/location-queries';

const router = Router();

// ─── 장소 목록/상세 ──────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const conn = await getConnection();
    try {
      const rows = await listLocations(conn);
      const withMeta = await Promise.all(
        rows.map(async (r) => {
          const latestJobId = await getLatestLocJob(conn, r.LOCATION_ID);
          const refImageCount = await countLocRefImages(conn, r.LOCATION_ID);
          return { ...r, LATEST_JOB_ID: latestJobId, REF_IMAGE_COUNT: refImageCount };
        }),
      );
      res.json({ success: true, data: withMeta });
    } finally {
      await conn.close();
    }
  }),
);

router.get(
  '/:locationId',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const conn = await getConnection();
    try {
      const row = await findLocationById(conn, locationId);
      if (!row) {
        res.status(404).json({ success: false, error: '장소를 찾을 수 없습니다' });
        return;
      }
      res.json({ success: true, data: row });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 장소 등록 ────────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const locationId = body.locationId as string | undefined;
    const name = body.name as string | undefined;
    if (!locationId || !name) {
      res.status(400).json({ success: false, error: 'locationId와 name은 필수입니다' });
      return;
    }

    const conn = await getConnection();
    try {
      await insertLocation(conn, {
        locationId,
        name,
        nameEn: (body.nameEn as string) || null,
        locationType: (body.locationType as string) || null,
        promptBase: (body.promptBase as string) || null,
        description: (body.description as string) || null,
      });
      res.json({ success: true });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 후보 조회 ────────────────────────────────────────────

router.get(
  '/candidates/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const conn = await getConnection();
    try {
      const rows = await listLocCandidatesByJob(conn, jobId);
      if (rows.length === 0) {
        res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
        return;
      }
      const locationId = rows[0].LOCATION_ID;
      const candidates = rows.map((r) => ({
        candidateId: r.CANDIDATE_ID,
        imagePath: r.IMAGE_PATH,
        prompt: r.PROMPT_TEXT ?? '',
        seed: r.SEED ?? 0,
        qualityScore: r.QUALITY_SCORE ?? undefined,
        liked: r.LIKED === 1,
        isAnchor: r.IS_ANCHOR === 1,
        jobId: r.JOB_ID,
      }));
      res.json({
        success: true,
        data: { jobId, locationId, status: 'completed', total: rows.length, completed: rows.length, candidates },
      });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 좋아요/앵커 ─────────────────────────────────────────

router.post(
  '/candidates/:jobId/like',
  asyncHandler(async (req: Request, res: Response) => {
    const { candidateId } = req.body as { candidateId: number };
    if (!candidateId) {
      res.status(400).json({ success: false, error: 'candidateId는 필수입니다' });
      return;
    }
    const conn = await getConnection();
    try {
      const newValue = await toggleLocCandidateLike(conn, candidateId);
      res.json({ success: true, liked: newValue });
    } finally {
      await conn.close();
    }
  }),
);

router.post(
  '/candidates/:jobId/anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const { anchorCandidateId } = req.body as { anchorCandidateId: number };
    if (!anchorCandidateId) {
      res.status(400).json({ success: false, error: 'anchorCandidateId는 필수입니다' });
      return;
    }
    const conn = await getConnection();
    try {
      await setLocAnchorCandidate(conn, anchorCandidateId);
      const candidates = await listLocCandidatesByJob(conn, String(req.params.jobId));
      const anchor = candidates.find((c) => c.CANDIDATE_ID === anchorCandidateId);
      if (anchor) {
        // location_type을 'anchor_set'으로 변경
        await conn.execute(
          'UPDATE locations SET location_type = :lt WHERE location_id = :lid',
          { lt: 'anchor_set', lid: anchor.LOCATION_ID },
          { autoCommit: true },
        );
      }
      res.json({ success: true });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/routes/location-routes.ts
git commit -m "feat: add location CRUD and candidate API routes"
```

---

### Task 5: app.ts에 장소 라우트 마운트

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: import 추가**

기존 import 목록에 추가:

```typescript
import locationRoutes from './locations/routes/location-routes';
```

- [ ] **Step 2: 라우트 등록**

기존 `app.use('/api/characters', loraRoutes);` 뒤에 추가:

```typescript
app.use('/api/locations', locationRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: mount location API routes at /api/locations"
```

---

### Task 6: 장소 관리 페이지 라우트

**Files:**
- Modify: `src/web/routes/web-routes.ts`

- [ ] **Step 1: 장소 페이지 라우트 추가**

파일에서 에피소드 라우트 섹션 (`// ─── 에피소드 관리`) 바로 앞에 추가:

```typescript
// ─── 장소 관리 ──────────────────────────────────────────────

router.get('/locations', (_req: Request, res: Response) => {
  res.render('locations/manage', { title: '장소 관리' });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/web/routes/web-routes.ts
git commit -m "feat: add location manage page route"
```

---

### Task 7: 사이드바에 장소 관리 메뉴 추가

**Files:**
- Modify: `src/web/views/sidebar.ejs`

- [ ] **Step 1: 제작 섹션에 장소 관리 링크 추가**

사이드바의 "제작" 섹션에서 `<a href="/characters"` 링크 뒤, `<a href="/episodes"` 링크 앞에 추가:

```html
    <a href="/locations" class="sidebar-link" data-path="/locations">
      <svg class="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <span>장소 관리</span>
    </a>
```

- [ ] **Step 2: Commit**

```bash
git add src/web/views/sidebar.ejs
git commit -m "feat: add location management link to sidebar"
```

---

### Task 8: 장소 관리 페이지 (manage.ejs)

**Files:**
- Create: `src/web/views/locations/manage.ejs`

- [ ] **Step 1: 관리 페이지 생성**

```html
<div>
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <h2 class="text-3xl font-headline font-extrabold text-[#e5e1e4]">장소 관리</h2>
    <button id="btn-add" class="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-semibold px-4 py-2 rounded-lg transition flex items-center gap-2">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
      새 장소 등록
    </button>
  </div>

  <!-- 로딩 -->
  <div id="loading" class="text-center py-20 text-[#ccc3d8]">불러오는 중...</div>

  <!-- 카드 그리드 -->
  <div id="loc-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 hidden"></div>

  <!-- 빈 상태 -->
  <div id="empty-state" class="text-center py-20 text-[#ccc3d8] hidden">등록된 장소가 없습니다.</div>

  <!-- 등록 모달 -->
  <div id="add-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center hidden">
    <div class="bg-[#2a2a2c] rounded-xl p-6 w-[28rem] shadow-xl max-h-[90vh] overflow-y-auto">
      <h3 class="text-lg font-semibold text-[#e5e1e4] mb-4">새 장소 등록</h3>

      <div class="mb-3">
        <label class="block text-sm text-[#ccc3d8] mb-1">장소 ID</label>
        <input id="modal-id" type="text" placeholder="예: classroom_3b" class="w-full bg-[#353437] border border-[#4a4455] rounded-lg px-3 py-2 text-sm text-[#e5e1e4] focus:outline-none focus:border-[#7c3aed]">
      </div>
      <div class="mb-3">
        <label class="block text-sm text-[#ccc3d8] mb-1">장소 이름</label>
        <input id="modal-name" type="text" placeholder="예: 3학년 B반 교실" class="w-full bg-[#353437] border border-[#4a4455] rounded-lg px-3 py-2 text-sm text-[#e5e1e4] focus:outline-none focus:border-[#7c3aed]">
      </div>
      <div class="mb-3">
        <label class="block text-sm text-[#ccc3d8] mb-1">영문 이름 (선택)</label>
        <input id="modal-name-en" type="text" placeholder="예: Classroom 3-B" class="w-full bg-[#353437] border border-[#4a4455] rounded-lg px-3 py-2 text-sm text-[#e5e1e4] focus:outline-none focus:border-[#7c3aed]">
      </div>
      <div class="mb-3">
        <label class="block text-sm text-[#ccc3d8] mb-1">장소 유형</label>
        <select id="modal-type" class="w-full bg-[#353437] border border-[#4a4455] rounded-lg px-3 py-2 text-sm text-[#e5e1e4] focus:outline-none focus:border-[#7c3aed]">
          <option value="main">핵심 장소 (LoRA 학습)</option>
          <option value="sub">보조 장소 (배경 고정)</option>
          <option value="background">배경 (프롬프트만)</option>
        </select>
      </div>
      <div class="mb-3">
        <label class="block text-sm text-[#ccc3d8] mb-1">기본 프롬프트</label>
        <textarea id="modal-prompt" rows="4" placeholder="empty room, no people, ..." class="w-full bg-[#353437] border border-[#4a4455] rounded-lg px-3 py-2 text-sm text-[#e5e1e4] placeholder-[#958da1] focus:outline-none focus:border-[#7c3aed] resize-none"></textarea>
      </div>
      <div class="mb-4">
        <label class="block text-sm text-[#ccc3d8] mb-1">설명 (선택)</label>
        <textarea id="modal-desc" rows="2" placeholder="장소에 대한 설명..." class="w-full bg-[#353437] border border-[#4a4455] rounded-lg px-3 py-2 text-sm text-[#e5e1e4] placeholder-[#958da1] focus:outline-none focus:border-[#7c3aed] resize-none"></textarea>
      </div>

      <div class="flex gap-3 justify-end">
        <button id="modal-cancel" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-4 py-2 rounded-lg transition">취소</button>
        <button id="modal-submit" class="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-semibold px-4 py-2 rounded-lg transition">등록</button>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  var grid = document.getElementById('loc-grid');
  var loading = document.getElementById('loading');
  var emptyState = document.getElementById('empty-state');
  var modal = document.getElementById('add-modal');
  var locations = [];

  var typeMap = { main: '핵심 (LoRA)', sub: '보조', background: '배경', anchor_set: '확정' };
  var typeColorMap = {
    main: 'bg-purple-500/20 text-purple-400',
    anchor_set: 'bg-green-500/20 text-green-400',
    sub: 'bg-blue-500/20 text-blue-400',
    background: 'bg-gray-500/20 text-gray-400',
  };

  function createHomeSvg() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'w-16 h-16 text-[#ccc3d8]/20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('stroke-width', '1');
    p.setAttribute('d', 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z');
    svg.appendChild(p);
    return svg;
  }

  function createCard(loc) {
    var card = document.createElement('div');
    card.className = 'bg-[#2a2a2c] rounded-lg overflow-hidden group';

    var thumbArea = document.createElement('div');
    thumbArea.className = 'aspect-[4/3] bg-[#353437] flex items-center justify-center';
    thumbArea.appendChild(createHomeSvg());
    card.appendChild(thumbArea);

    var body = document.createElement('div');
    body.className = 'p-4';

    var header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-2';
    var nameEl = document.createElement('h3');
    nameEl.className = 'text-base font-semibold text-[#e5e1e4]';
    nameEl.textContent = loc.NAME;
    var idEl = document.createElement('span');
    idEl.className = 'text-[10px] text-[#958da1] font-mono';
    idEl.textContent = loc.LOCATION_ID;
    header.appendChild(nameEl);
    header.appendChild(idEl);
    body.appendChild(header);

    var locType = loc.LOCATION_TYPE || 'main';
    var typeCls = typeColorMap[locType] || 'bg-purple-500/20 text-purple-400';
    var badge = document.createElement('span');
    badge.className = 'inline-block text-[10px] ' + typeCls + ' px-2 py-0.5 rounded-full mb-3';
    badge.textContent = typeMap[locType] || locType;
    body.appendChild(badge);

    if (loc.PROMPT_BASE) {
      var promptEl = document.createElement('p');
      promptEl.className = 'text-xs text-[#958da1] mb-3 line-clamp-2';
      promptEl.textContent = loc.PROMPT_BASE;
      body.appendChild(promptEl);
    }

    var actions = document.createElement('div');
    actions.className = 'flex gap-2 mt-4';

    var genBtn = document.createElement('button');
    genBtn.className = 'flex-1 bg-[#7c3aed]/20 hover:bg-[#7c3aed]/40 text-[#d2bbff] text-xs py-2 rounded-lg transition font-semibold';
    genBtn.textContent = '후보 생성';
    genBtn.addEventListener('click', function() {
      alert('Phase B에서 구현 예정');
    });
    actions.appendChild(genBtn);

    if (loc.LATEST_JOB_ID) {
      var viewBtn = document.createElement('a');
      viewBtn.href = '/locations/candidates/' + encodeURIComponent(loc.LATEST_JOB_ID);
      viewBtn.className = 'flex-1 bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-xs py-2 rounded-lg transition text-center';
      viewBtn.textContent = '기존 후보 보기';
      actions.appendChild(viewBtn);
    }

    if (loc.REF_IMAGE_COUNT > 0) {
      var galleryBtn = document.createElement('a');
      galleryBtn.href = '/locations/' + encodeURIComponent(loc.LOCATION_ID) + '/gallery';
      galleryBtn.className = 'flex-1 bg-green-500/20 hover:bg-green-500/40 text-green-400 text-xs py-2 rounded-lg transition text-center font-semibold';
      galleryBtn.textContent = '갤러리 (' + loc.REF_IMAGE_COUNT + ')';
      actions.appendChild(galleryBtn);
    }

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  async function loadLocations() {
    try {
      var res = await fetch('/api/locations/');
      var json = await res.json();
      locations = json.data || [];
      loading.classList.add('hidden');
      if (locations.length === 0) { emptyState.classList.remove('hidden'); return; }
      grid.classList.remove('hidden');
      grid.textContent = '';
      locations.forEach(function(loc) { grid.appendChild(createCard(loc)); });
    } catch (err) {
      loading.textContent = '장소 목록을 불러오지 못했습니다.';
    }
  }

  // 모달
  document.getElementById('btn-add').addEventListener('click', function() { modal.classList.remove('hidden'); });
  document.getElementById('modal-cancel').addEventListener('click', function() { modal.classList.add('hidden'); });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.add('hidden'); });

  document.getElementById('modal-submit').addEventListener('click', async function() {
    var locationId = document.getElementById('modal-id').value.trim();
    var name = document.getElementById('modal-name').value.trim();
    if (!locationId || !name) { alert('장소 ID와 이름은 필수입니다.'); return; }

    var btn = document.getElementById('modal-submit');
    btn.disabled = true; btn.textContent = '등록 중...';

    try {
      var res = await fetch('/api/locations/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: locationId,
          name: name,
          nameEn: document.getElementById('modal-name-en').value.trim() || null,
          locationType: document.getElementById('modal-type').value,
          promptBase: document.getElementById('modal-prompt').value.trim() || null,
          description: document.getElementById('modal-desc').value.trim() || null,
        }),
      });
      var json = await res.json();
      if (json.success) {
        modal.classList.add('hidden');
        loadLocations();
      } else {
        alert('등록 실패: ' + (json.error || '알 수 없는 오류'));
      }
    } catch (err) {
      alert('요청 실패: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '등록';
    }
  });

  loadLocations();
})();
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/web/views/locations/manage.ejs
git commit -m "feat: add location management page"
```

---

### Task 9: 빌드 확인

- [ ] **Step 1: TypeScript 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없이 종료

- [ ] **Step 2: 수동 테스트 체크리스트**

1. 사이드바에 "장소 관리" 메뉴가 보이는지 확인
2. `/locations` 페이지에서 "새 장소 등록" 모달이 열리는지 확인
3. 장소 등록 후 카드가 그리드에 나타나는지 확인
4. `GET /api/locations/` API가 정상 응답하는지 확인

- [ ] **Step 3: Commit (if needed)**

```bash
git commit -m "chore: verify location management Phase A build"
```
