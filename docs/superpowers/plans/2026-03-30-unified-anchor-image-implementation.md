# 통합 앵커 이미지 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "후보(candidate)" 개념을 완전히 제거하고 "앵커 이미지" 개념으로 통합. 캐릭터/장소/NPC가 동일한 폴리모르픽 인터페이스로 앵커 이미지를 생성하고 관리.

**Architecture:**
- 폴리모르픽 `anchor_images` 테이블 (entity_type + entity_id)
- 공통 생성 로직 (`src/common/services/anchor-image-generator.ts`)
- 도메인별 래퍼 (캐릭터/장소는 공통 모듈 호출)
- 단일 API 엔드포인트 (`/api/anchors/*`)

**Tech Stack:** TypeScript, Express, Oracle 26ai, ComfyUI, Python FastAPI (품질 평가)

---

## 파일 구조

**생성:**
- `src/db/migrations/20260330_anchor_images.sql` — 테이블 생성/삭제
- `src/common/services/anchor-image-generator.ts` — 공통 생성 로직
- `src/common/services/anchor-image-processor.ts` — 개별 처리 로직
- `src/common/types/anchor-image.types.ts` — 타입 정의
- `src/db/queries/anchor-image-queries.ts` — DB 쿼리
- `src/characters/services/character-anchor.ts` — 캐릭터 래퍼
- `src/characters/routes/character-anchor-routes.ts` — 캐릭터 라우트
- `src/locations/services/location-anchor.ts` — 장소 래퍼
- `src/locations/routes/location-anchor-routes.ts` — 장소 라우트

**수정:**
- `src/app.ts` — 라우트 등록
- `src/characters/types/character.types.ts` — anchor_id 추가
- `src/locations/types/location.types.ts` — anchor_id 추가

**삭제:**
- `src/characters/services/candidate-generator.ts`
- `src/characters/services/candidate-processor.ts`
- `src/characters/routes/candidate-routes.ts`
- `src/locations/services/location-candidate-generator.ts`
- `src/locations/routes/location-candidate-routes.ts`
- `src/db/queries/candidate-queries.ts`
- `src/db/queries/location-candidate-queries.ts`
- `src/web/views/characters/candidates.ejs`
- `src/web/views/locations/candidates.ejs`

---

## Task 1: DB 마이그레이션 스크립트 작성

**Files:**
- Create: `src/db/migrations/20260330_anchor_images.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

생성할 파일: `src/db/migrations/20260330_anchor_images.sql`

```sql
-- ============================================
-- Migration: 20260330 - Anchor Images System
-- ============================================

-- 1. 구 테이블 삭제
BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE char_candidates';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
  EXECUTE IMMEDIATE 'DROP TABLE location_candidates';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- 2. 신규 테이블 생성
CREATE TABLE anchor_images (
  anchor_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type     VARCHAR2(20) NOT NULL
                  CHECK (entity_type IN ('character', 'location', 'npc')),
  entity_id       VARCHAR2(50) NOT NULL,

  -- 이미지 & 메타
  image_blob      BLOB NOT NULL,
  thumbnail_blob  BLOB,
  image_path      VARCHAR2(500),

  -- 생성 정보
  job_id          VARCHAR2(100),
  prompt_text     VARCHAR2(2000),
  seed            NUMBER,
  quality_score   NUMBER(3,2),
  grade           VARCHAR2(1),

  -- 얼굴 정보 (캐릭터용)
  face_bbox       VARCHAR2(200),

  -- 타임스탐프
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- 제약
  UNIQUE (entity_type, entity_id)
);

-- 3. 인덱스
CREATE INDEX idx_anchor_entity ON anchor_images(entity_type, entity_id);
CREATE INDEX idx_anchor_job ON anchor_images(job_id);

-- 4. characters 테이블 수정
ALTER TABLE characters RENAME COLUMN anchor_blob TO anchor_id_old;
ALTER TABLE characters ADD anchor_id NUMBER REFERENCES anchor_images(anchor_id);
ALTER TABLE characters DROP COLUMN anchor_id_old;
ALTER TABLE characters DROP COLUMN anchor_thumbnail;
ALTER TABLE characters DROP COLUMN face_embedding;

-- 5. locations 테이블 수정
ALTER TABLE locations ADD anchor_id NUMBER REFERENCES anchor_images(anchor_id);

COMMIT;
```

- [ ] **Step 2: 마이그레이션 실행 확인**

```bash
# 마이그레이션 실행 (별도 스크립트 또는 수동)
# 파일 저장만 하고 Step 3에서 실행하도록 함
```

---

## Task 2: 타입 정의

**Files:**
- Create: `src/common/types/anchor-image.types.ts`

- [ ] **Step 1: 타입 파일 작성**

생성할 파일: `src/common/types/anchor-image.types.ts`

```typescript
/**
 * @module 앵커 이미지 타입
 * @description 캐릭터/장소/NPC의 앵커 이미지 생성 및 관리 타입
 */

export type AnchorEntityType = 'character' | 'location' | 'npc';

export interface AnchorGenerationRequest {
  entityType: AnchorEntityType;
  entityId: string;
  count: number;
  customPrompt?: string;
  pulidOpts?: PulidModeOptions;
}

export interface PulidModeOptions {
  referenceImagePath: string;
  pulidStrength: number;
  guidance: number;
}

export interface AnchorResult {
  anchorId?: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  prompt: string;
  seed: number;
  qualityScore?: number;
  grade?: string;
}

export interface AnchorGenerationJob {
  jobId: string;
  entityType: AnchorEntityType;
  entityId: string;
  status: 'generating' | 'scoring' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  anchors: AnchorResult[];
  lastError?: string;
  shouldStop?: boolean;
}

export interface AnchorImageRow {
  ANCHOR_ID: number;
  ENTITY_TYPE: AnchorEntityType;
  ENTITY_ID: string;
  IMAGE_BLOB: Buffer;
  THUMBNAIL_BLOB?: Buffer;
  IMAGE_PATH?: string;
  JOB_ID?: string;
  PROMPT_TEXT?: string;
  SEED?: number;
  QUALITY_SCORE?: number;
  GRADE?: string;
  FACE_BBOX?: string;
  CREATED_AT: Date;
  UPDATED_AT: Date;
}

export interface AnchorInsertData {
  entityType: AnchorEntityType;
  entityId: string;
  imageBlob: Buffer;
  thumbnailBlob: Buffer;
  imagePath: string;
  jobId: string;
  promptText: string;
  seed: number;
  qualityScore: number | null;
  grade: string | null;
  faceBbox: string | null;
}
```

---

## Task 3: DB 쿼리 작성

**Files:**
- Create: `src/db/queries/anchor-image-queries.ts`

- [ ] **Step 1: 쿼리 파일 작성**

생성할 파일: `src/db/queries/anchor-image-queries.ts`

```typescript
/**
 * @module 앵커 이미지 쿼리
 * @description anchor_images 테이블 CRUD 쿼리
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';
import type { AnchorImageRow, AnchorInsertData } from '../../common/types/anchor-image.types';

export const INSERT_ANCHOR = `
  INSERT INTO anchor_images
    (entity_type, entity_id, image_blob, thumbnail_blob, image_path,
     job_id, prompt_text, seed, quality_score, grade, face_bbox)
  VALUES
    (:entityType, :entityId, :imageBlob, :thumbnailBlob, :imagePath,
     :jobId, :promptText, :seed, :qualityScore, :grade, :faceBbox)
  RETURNING anchor_id INTO :anchorId
`;

export const LIST_BY_JOB = `
  SELECT * FROM anchor_images
   WHERE job_id = :jobId
   ORDER BY anchor_id DESC
`;

export const GET_ANCHOR = `
  SELECT * FROM anchor_images WHERE anchor_id = :anchorId
`;

export const GET_BY_ENTITY = `
  SELECT * FROM anchor_images
   WHERE entity_type = :entityType AND entity_id = :entityId
`;

export const SET_ENTITY_ANCHOR = `
  UPDATE characters SET anchor_id = :anchorId WHERE char_id = :entityId
  UNION ALL
  UPDATE locations SET anchor_id = :anchorId WHERE location_id = :entityId
`;

export const CLEAR_ENTITY_ANCHOR = `
  UPDATE characters SET anchor_id = NULL WHERE char_id = :entityId
  UNION ALL
  UPDATE locations SET anchor_id = NULL WHERE location_id = :entityId
`;

export async function insertAnchor(
  conn: oracledb.Connection,
  data: AnchorInsertData
): Promise<number> {
  const binds = {
    ...data,
    anchorId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await conn.execute(
    INSERT_ANCHOR,
    binds as unknown as Record<string, unknown>,
    { autoCommit: true }
  );
  const outBinds = result.outBinds as unknown as { anchorId: number[] };
  const anchorId = outBinds.anchorId[0];
  logger.debug('앵커 이미지 저장', {
    entityType: data.entityType,
    entityId: data.entityId,
    anchorId
  });
  return anchorId;
}

export async function listByJob(
  conn: oracledb.Connection,
  jobId: string
): Promise<AnchorImageRow[]> {
  const result = await conn.execute<AnchorImageRow>(
    LIST_BY_JOB,
    { jobId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  logger.debug('앵커 목록 조회', { jobId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function getAnchor(
  conn: oracledb.Connection,
  anchorId: number
): Promise<AnchorImageRow | null> {
  const result = await conn.execute<AnchorImageRow>(
    GET_ANCHOR,
    { anchorId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return result.rows?.[0] ?? null;
}

export async function getByEntity(
  conn: oracledb.Connection,
  entityType: string,
  entityId: string
): Promise<AnchorImageRow | null> {
  const result = await conn.execute<AnchorImageRow>(
    GET_BY_ENTITY,
    { entityType, entityId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  logger.debug('엔티티 앵커 조회', { entityType, entityId });
  return result.rows?.[0] ?? null;
}

export async function setEntityAnchor(
  conn: oracledb.Connection,
  entityType: string,
  entityId: string,
  anchorId: number
): Promise<void> {
  // entity_type에 따라 분기
  if (entityType === 'character') {
    await conn.execute(
      'UPDATE characters SET anchor_id = :anchorId WHERE char_id = :entityId',
      { anchorId, entityId },
      { autoCommit: true }
    );
  } else if (entityType === 'location') {
    await conn.execute(
      'UPDATE locations SET anchor_id = :anchorId WHERE location_id = :entityId',
      { anchorId, entityId },
      { autoCommit: true }
    );
  }
  logger.info('엔티티 앵커 설정', { entityType, entityId, anchorId });
}

export async function clearEntityAnchor(
  conn: oracledb.Connection,
  entityType: string,
  entityId: string
): Promise<void> {
  if (entityType === 'character') {
    await conn.execute(
      'UPDATE characters SET anchor_id = NULL WHERE char_id = :entityId',
      { entityId },
      { autoCommit: true }
    );
  } else if (entityType === 'location') {
    await conn.execute(
      'UPDATE locations SET anchor_id = NULL WHERE location_id = :entityId',
      { entityId },
      { autoCommit: true }
    );
  }
  logger.info('엔티티 앵커 해제', { entityType, entityId });
}
```

---

## Task 4: 공통 생성 모듈

**Files:**
- Create: `src/common/services/anchor-image-generator.ts`

- [ ] **Step 1: 생성 모듈 작성**

생성할 파일: `src/common/services/anchor-image-generator.ts`

```typescript
/**
 * @module 앵커 이미지 생성 서비스
 * @description 폴리모르픽 앵커 이미지 배치 생성 (캐릭터/장소/NPC)
 */

import path from 'path';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir } from '../../common/utils/file-utils';
import { logger } from '../../common/logger';
import { processOneAnchor } from './anchor-image-processor';
import type {
  AnchorGenerationRequest,
  AnchorGenerationJob,
  AnchorResult
} from '../../common/types/anchor-image.types';

const activeJobs: Map<string, AnchorGenerationJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/anchors');

export async function startAnchorGeneration(
  req: AnchorGenerationRequest
): Promise<string> {
  const jobId = generateJobId('anch');
  const job: AnchorGenerationJob = {
    jobId,
    entityType: req.entityType,
    entityId: req.entityId,
    status: 'generating',
    total: req.count,
    completed: 0,
    anchors: [],
  };

  activeJobs.set(jobId, job);
  logger.info('앵커 생성 작업 시작', {
    jobId,
    entityType: req.entityType,
    entityId: req.entityId,
    count: req.count,
  });

  processBatch(job, req).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('앵커 배치 생성 실패', { jobId, error: message });
    job.status = 'failed';
  });

  return jobId;
}

export function getJob(jobId: string): AnchorGenerationJob | undefined {
  return activeJobs.get(jobId);
}

export function getJobAnchors(jobId: string): AnchorResult[] {
  return activeJobs.get(jobId)?.anchors ?? [];
}

export function stopAnchorGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  logger.info('앵커 생성 중단 요청', { jobId });
  return true;
}

async function processBatch(
  job: AnchorGenerationJob,
  req: AnchorGenerationRequest
): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, req.entityType, req.entityId, job.jobId);
  await ensureDir(outDir);

  for (let i = 0; i < req.count; i++) {
    if (job.shouldStop) {
      job.status = 'stopped';
      logger.info('앵커 생성 중단', {
        jobId: job.jobId,
        completed: job.completed,
        total: job.total,
      });
      break;
    }

    try {
      await processOneAnchor(job, req.entityType, outDir, req.customPrompt, req.pulidOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.lastError = msg;
      logger.error('개별 앵커 생성 실패', { jobId: job.jobId, error: msg });
      if (job.completed === 0) {
        job.status = 'failed';
        return;
      }
    }
  }

  if (!job.shouldStop) {
    job.status = 'completed';
    logger.info('앵커 배치 생성 완료', {
      jobId: job.jobId,
      total: job.total,
      completed: job.completed,
    });
  }
}
```

---

## Task 5: 개별 처리 모듈

**Files:**
- Create: `src/common/services/anchor-image-processor.ts`

- [ ] **Step 1: 처리 모듈 작성**

생성할 파일: `src/common/services/anchor-image-processor.ts`

```typescript
/**
 * @module 앵커 이미지 개별 처리
 * @description 1개 앵커 이미지 생성 → 품질 평가 → DB 저장
 */

import path from 'path';
import { comfyuiClient } from '../../comfyui/client';
import {
  buildKontextAnchorWorkflow,
  buildPulidAnchorWorkflow,
} from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { scoreImage } from '../../python-api/endpoints/quality-api';
import { getFaceBoundingBox } from '../../python-api/endpoints/embedding-api';
import { getConnection } from '../../db/connection';
import { insertAnchor } from '../../db/queries/anchor-image-queries';
import { writeFileBuffer, readFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';
import type {
  AnchorGenerationJob,
  AnchorEntityType,
  PulidModeOptions
} from '../../common/types/anchor-image.types';

function assignGrade(score: number): string {
  if (score >= 0.9) return 'S';
  if (score >= 0.8) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}

async function generateAndSaveImage(
  entityType: AnchorEntityType,
  entityId: string,
  outDir: string,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<string> {
  const seed = Math.floor(Math.random() * 999999999);

  // 프롬프트 빌드 (간단하게 customPrompt 사용, 또는 엔티티 타입별 기본값)
  const prompt = customPrompt || `${entityType} ${entityId}`;

  await comfyuiClient.connect();

  let workflow;
  if (pulidOpts) {
    const refName = await comfyuiClient.uploadImage(pulidOpts.referenceImagePath);
    workflow = buildPulidAnchorWorkflow({
      referenceImageName: refName,
      prompt,
      seed,
      pulidStrength: pulidOpts.pulidStrength,
      guidance: pulidOpts.guidance,
      filenamePrefix: `${entityType}_${entityId}_${seed}`,
    });
  } else {
    workflow = buildKontextAnchorWorkflow({
      prompt,
      seed,
      filenamePrefix: `${entityType}_${entityId}_${seed}`,
    });
  }

  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const { images } = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${entityType}_${entityId}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  return imagePath;
}

export async function processOneAnchor(
  job: AnchorGenerationJob,
  entityType: AnchorEntityType,
  outDir: string,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<void> {
  const seed = Math.floor(Math.random() * 999999999);
  const prompt = customPrompt || `${entityType} ${job.entityId}`;

  const imagePath = await generateAndSaveImage(
    entityType,
    job.entityId,
    outDir,
    customPrompt,
    pulidOpts
  );

  job.status = 'scoring';
  let faceBbox: string | null = null;

  try {
    const [scoreResult, bboxResult] = await Promise.all([
      scoreImage(imagePath),
      entityType === 'character' ? getFaceBoundingBox(imagePath) : Promise.resolve({ success: false }),
    ]);

    let qualityScore: number | null = null;
    let grade: string | null = null;

    if (scoreResult.success && scoreResult.data) {
      qualityScore = scoreResult.data.score;
      grade = assignGrade(scoreResult.data.score);
    }

    if (bboxResult.success && bboxResult.data) {
      faceBbox = JSON.stringify(bboxResult.data);
      logger.debug('얼굴 좌표 추출 완료', { jobId: job.jobId, bbox: faceBbox });
    }

    // DB 저장
    const imageBuffer = await readFileBuffer(imagePath);
    const thumbBuffer = await createThumbnail(imageBuffer);

    const conn = await getConnection();
    try {
      const anchorId = await insertAnchor(conn, {
        entityType,
        entityId: job.entityId,
        imageBlob: imageBuffer,
        thumbnailBlob: thumbBuffer,
        imagePath,
        jobId: job.jobId,
        promptText: prompt,
        seed,
        qualityScore: qualityScore ?? null,
        grade: grade ?? null,
        faceBbox,
      });

      job.anchors.push({
        anchorId,
        imageUrl: `/api/images/anchors/${anchorId}`,
        thumbnailUrl: `/api/images/anchors/${anchorId}?thumbnail=true`,
        prompt,
        seed,
        qualityScore,
        grade,
      });
    } finally {
      await conn.close();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('AI 분석 일부 실패 (건너뜀)', { jobId: job.jobId, error: msg });
  }

  job.completed += 1;
  job.status = 'generating';
  logger.debug('앵커 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
  });
}
```

---

## Task 6: 캐릭터 앵커 서비스

**Files:**
- Create: `src/characters/services/character-anchor.ts`

- [ ] **Step 1: 캐릭터 앵커 서비스 작성**

생성할 파일: `src/characters/services/character-anchor.ts`

```typescript
/**
 * @module 캐릭터 앵커 서비스
 * @description 캐릭터의 앵커 이미지 생성/관리 (공통 모듈 래퍼)
 */

import { startAnchorGeneration } from '../../common/services/anchor-image-generator';
import { getConnection } from '../../db/connection';
import { setEntityAnchor, getByEntity } from '../../db/queries/anchor-image-queries';
import { logger } from '../../common/logger';
import type { PulidModeOptions } from '../../common/types/anchor-image.types';

export async function startCharacterAnchorGeneration(
  charId: string,
  count: number,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<string> {
  return startAnchorGeneration({
    entityType: 'character',
    entityId: charId,
    count,
    customPrompt,
    pulidOpts,
  });
}

export async function setCharacterAnchor(
  charId: string,
  anchorId: number,
): Promise<void> {
  const conn = await getConnection();
  try {
    await setEntityAnchor(conn, 'character', charId, anchorId);
    logger.info('캐릭터 앵커 설정 완료', { charId, anchorId });
  } finally {
    await conn.close();
  }
}

export async function getCharacterAnchor(charId: string) {
  const conn = await getConnection();
  try {
    return await getByEntity(conn, 'character', charId);
  } finally {
    await conn.close();
  }
}
```

---

## Task 7: 캐릭터 앵커 라우트

**Files:**
- Create: `src/characters/routes/character-anchor-routes.ts`

- [ ] **Step 1: 캐릭터 라우트 작성**

생성할 파일: `src/characters/routes/character-anchor-routes.ts`

```typescript
/**
 * @module 캐릭터 앵커 라우트
 * @description 캐릭터 앵커 이미지 생성/관리 API
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  getJob,
  stopAnchorGeneration,
  getJobAnchors
} from '../../common/services/anchor-image-generator';
import {
  startCharacterAnchorGeneration,
  setCharacterAnchor,
  getCharacterAnchor
} from '../services/character-anchor';
import { logger } from '../../common/logger';

const router = Router();

// POST /api/characters/:charId/anchors/generate
router.post(
  '/:charId/anchors/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { count = 5, customPrompt, pulidOpts } = req.body;

    const jobId = await startCharacterAnchorGeneration(
      charId,
      count,
      customPrompt,
      pulidOpts
    );

    res.json({ jobId });
  })
);

// GET /api/anchors/:jobId/stream (SSE)
router.get(
  '/anchors/:jobId/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!job) {
      res.write('event: error\ndata: {"message":"Job not found"}\n\n');
      res.end();
      return;
    }

    const interval = setInterval(() => {
      const anchors = getJobAnchors(jobId);
      res.write(
        `event: anchor-progress\ndata: ${JSON.stringify({
          status: job.status,
          completed: job.completed,
          total: job.total,
          anchors,
        })}\n\n`
      );

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped') {
        clearInterval(interval);
        res.end();
      }
    }, 1000);
  })
);

// POST /api/anchors/:jobId/stop
router.post(
  '/anchors/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const success = stopAnchorGeneration(jobId);
    res.json({ success });
  })
);

// POST /api/characters/:charId/anchor/:anchorId
router.post(
  '/:charId/anchor/:anchorId',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const anchorId = Number(req.params.anchorId);

    await setCharacterAnchor(charId, anchorId);

    res.json({ charId, anchorId });
  })
);

// GET /api/characters/:charId/anchor
router.get(
  '/:charId/anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const anchor = await getCharacterAnchor(charId);

    res.json(anchor ?? null);
  })
);

export default router;
```

---

## Task 8: 장소 앵커 서비스

**Files:**
- Create: `src/locations/services/location-anchor.ts`

- [ ] **Step 1: 장소 앵커 서비스 작성**

생성할 파일: `src/locations/services/location-anchor.ts`

```typescript
/**
 * @module 장소 앵커 서비스
 * @description 장소의 앵커 이미지 생성/관리 (공통 모듈 래퍼)
 */

import { startAnchorGeneration } from '../../common/services/anchor-image-generator';
import { getConnection } from '../../db/connection';
import { setEntityAnchor, getByEntity } from '../../db/queries/anchor-image-queries';
import { logger } from '../../common/logger';
import type { PulidModeOptions } from '../../common/types/anchor-image.types';

export async function startLocationAnchorGeneration(
  locationId: string,
  count: number,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<string> {
  return startAnchorGeneration({
    entityType: 'location',
    entityId: locationId,
    count,
    customPrompt,
    pulidOpts,
  });
}

export async function setLocationAnchor(
  locationId: string,
  anchorId: number,
): Promise<void> {
  const conn = await getConnection();
  try {
    await setEntityAnchor(conn, 'location', locationId, anchorId);
    logger.info('장소 앵커 설정 완료', { locationId, anchorId });
  } finally {
    await conn.close();
  }
}

export async function getLocationAnchor(locationId: string) {
  const conn = await getConnection();
  try {
    return await getByEntity(conn, 'location', locationId);
  } finally {
    await conn.close();
  }
}
```

---

## Task 9: 장소 앵커 라우트

**Files:**
- Create: `src/locations/routes/location-anchor-routes.ts`

- [ ] **Step 1: 장소 라우트 작성**

생성할 파일: `src/locations/routes/location-anchor-routes.ts`

```typescript
/**
 * @module 장소 앵커 라우트
 * @description 장소 앵커 이미지 생성/관리 API
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getJob, stopAnchorGeneration, getJobAnchors } from '../../common/services/anchor-image-generator';
import {
  startLocationAnchorGeneration,
  setLocationAnchor,
  getLocationAnchor
} from '../services/location-anchor';

const router = Router();

// POST /api/locations/:locationId/anchors/generate
router.post(
  '/:locationId/anchors/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const { count = 5, customPrompt, pulidOpts } = req.body;

    const jobId = await startLocationAnchorGeneration(
      locationId,
      count,
      customPrompt,
      pulidOpts
    );

    res.json({ jobId });
  })
);

// POST /api/locations/:locationId/anchor/:anchorId
router.post(
  '/:locationId/anchor/:anchorId',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const anchorId = Number(req.params.anchorId);

    await setLocationAnchor(locationId, anchorId);

    res.json({ locationId, anchorId });
  })
);

// GET /api/locations/:locationId/anchor
router.get(
  '/:locationId/anchor',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const anchor = await getLocationAnchor(locationId);

    res.json(anchor ?? null);
  })
);

export default router;
```

---

## Task 10: 앱 라우트 등록

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: 라우트 import 추가**

파일: `src/app.ts`에서 다음 라인을 찾으세요:
```typescript
import characterRoutes from './characters/routes/character-routes';
```

다음을 추가하세요:
```typescript
import characterAnchorRoutes from './characters/routes/character-anchor-routes';
import locationAnchorRoutes from './locations/routes/location-anchor-routes';
```

- [ ] **Step 2: 기존 후보 라우트 제거**

다음을 찾아서 삭제하세요:
```typescript
import candidateRoutes from './characters/routes/candidate-routes';
```

- [ ] **Step 3: 라우트 등록**

app.ts에서 라우트 등록 부분을 찾으세요 (일반적으로 `app.use('/api/characters', ...)` 형태).

기존 후보 라우트 등록을 제거:
```typescript
// app.use('/api/candidates', candidateRoutes);  // 삭제
```

새로운 앵커 라우트 등록을 추가:
```typescript
app.use('/api/characters', characterAnchorRoutes);
app.use('/api/locations', locationAnchorRoutes);
```

---

## Task 11: 타입 파일 수정

**Files:**
- Modify: `src/characters/types/character.types.ts`
- Modify: `src/locations/types/location.types.ts`

- [ ] **Step 1: Character 타입 수정**

파일: `src/characters/types/character.types.ts`에서:

기존의 `anchor_blob`, `anchor_thumbnail`, `face_embedding` 필드를 찾아서 삭제:
```typescript
// 삭제:
anchor_blob?: Buffer;
anchor_thumbnail?: Buffer;
face_embedding?: any;
```

다음을 추가:
```typescript
anchor_id?: number;  // 앵커 이미지 FK
```

- [ ] **Step 2: Location 타입 수정**

파일: `src/locations/types/location.types.ts`에서:

만약 Location 타입에 후보 관련 필드가 있다면 삭제.

다음을 추가:
```typescript
anchor_id?: number;  // 앵커 이미지 FK
```

---

## Task 12: 기존 후보 코드 삭제

**Files:**
- Delete: 다음 파일들 전부 삭제

```bash
# 캐릭터 후보
rm src/characters/services/candidate-generator.ts
rm src/characters/services/candidate-processor.ts
rm src/characters/routes/candidate-routes.ts

# 장소 후보
rm src/locations/services/location-candidate-generator.ts
rm src/locations/routes/location-candidate-routes.ts

# 공통 쿼리
rm src/db/queries/candidate-queries.ts
rm src/db/queries/location-candidate-queries.ts

# 웹 UI 템플릿
rm src/web/views/characters/candidates.ejs
rm src/web/views/locations/candidates.ejs
```

- [ ] **Step 1: 파일 삭제 실행**

```bash
cd /c/VideoFactory
rm -f src/characters/services/candidate-generator.ts
rm -f src/characters/services/candidate-processor.ts
rm -f src/characters/routes/candidate-routes.ts
rm -f src/locations/services/location-candidate-generator.ts
rm -f src/locations/routes/location-candidate-routes.ts
rm -f src/db/queries/candidate-queries.ts
rm -f src/db/queries/location-candidate-queries.ts
rm -f src/web/views/characters/candidates.ejs
rm -f src/web/views/locations/candidates.ejs
```

- [ ] **Step 2: 커밋**

```bash
git add -A
git commit -m "refactor: remove candidate-based system, consolidate to anchor-images"
```

---

## Task 13: 마이그레이션 실행

**Files:**
- Execute: `src/db/migrations/20260330_anchor_images.sql`

- [ ] **Step 1: 마이그레이션 실행**

```bash
# 또는 Node.js 스크립트로 실행하는 방식
# src/db/migrations에 runner가 있다면 활용
sqlplus <계정>/<비밀>@<TNSNAME> @src/db/migrations/20260330_anchor_images.sql
```

- [ ] **Step 2: 테이블 생성 확인**

```bash
# Node.js 스크립트로 확인
node -e "
const oracledb = require('oracledb');
(async () => {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionString: process.env.DB_CONNECTION_STRING
  });
  const result = await conn.execute('SELECT table_name FROM user_tables WHERE table_name = \\'ANCHOR_IMAGES\\'');
  console.log(result.rows);
  await conn.close();
})();
"
```

---

## Task 14: 컴파일 및 타입 체크

**Files:**
- Compile: 전체 TypeScript

- [ ] **Step 1: TypeScript 컴파일**

```bash
cd /c/VideoFactory
npm run build 2>&1 | tee tsc-errors.txt
```

- [ ] **Step 2: 컴파일 에러 확인 및 수정**

만약 에러가 나면 (대부분 import 경로나 타입 불일치):
- `src/app.ts` — 라우트 import 경로 재확인
- `src/characters/routes/character-anchor-routes.ts` — import 경로
- `src/locations/routes/location-anchor-routes.ts` — import 경로

---

## Task 15: 통합 테스트

**Files:**
- Test: 수동 테스트

- [ ] **Step 1: 서버 시작**

```bash
cd /c/VideoFactory
npm run dev
```

예상 출력: 포트 3000 서버 시작, ComfyUI 연결 확인

- [ ] **Step 2: 캐릭터 앵커 생성 API 테스트**

```bash
curl -X POST http://localhost:3000/api/characters/soyul/anchors/generate \
  -H "Content-Type: application/json" \
  -d '{
    "count": 2,
    "customPrompt": "Korean high school girl, bright expression"
  }'
```

예상 응답:
```json
{
  "jobId": "anch_20260330_abc123"
}
```

- [ ] **Step 3: 진행 상황 확인 (SSE)**

```bash
curl http://localhost:3000/api/anchors/anch_20260330_abc123/stream
```

예상: 1초마다 진행 상황 업데이트

- [ ] **Step 4: 앵커 설정**

생성이 완료되면 가장 첫 번째 앵커의 ID를 확인하고:

```bash
curl -X POST http://localhost:3000/api/characters/soyul/anchor/1 \
  -H "Content-Type: application/json"
```

예상 응답:
```json
{
  "charId": "soyul",
  "anchorId": 1
}
```

- [ ] **Step 5: 앵커 확인**

```bash
curl http://localhost:3000/api/characters/soyul/anchor
```

예상: 앵커 이미지 메타 정보 반환

---

## Task 16: 최종 커밋

**Files:**
- Commit: 모든 변경사항

- [ ] **Step 1: 변경사항 확인**

```bash
cd /c/VideoFactory
git status
```

- [ ] **Step 2: 최종 커밋**

```bash
git add -A
git commit -m "feat: unified anchor image system for character/location/npc

- Polymorphic anchor_images table (entity_type + entity_id)
- Common anchor-image-generator module (all entity types)
- Domain-specific wrappers (character-anchor, location-anchor)
- Single /api/anchors/* endpoint
- Removed legacy candidate-based system completely"
```

---

## 검증 체크리스트

- [ ] TypeScript 컴파일 성공
- [ ] 마이그레이션 테이블 생성 확인
- [ ] `/api/characters/{charId}/anchors/generate` 작동
- [ ] SSE 스트림 작동
- [ ] 앵커 이미지 DB 저장 확인
- [ ] `/api/characters/{charId}/anchor/{anchorId}` 설정 작동
- [ ] 장소도 동일 워크플로우 작동
- [ ] 기존 후보 코드 완전 삭제

