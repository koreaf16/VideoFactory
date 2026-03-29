# 장소 Phase C: 앵글 변형 + 갤러리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앵커 배경 이미지를 기반으로 12종 앵글 변형을 Kontext 편집으로 생성하고, 갤러리에서 조회/재생성할 수 있는 UI를 구축한다.

**Architecture:** 캐릭터 파생 이미지와 동일한 패턴. 앵커 확정 시 자동으로 변형 생성 시작. location_ref_images 테이블에 저장. EventEmitter로 SSE 진행률 전달.

**Tech Stack:** Express, EJS, ComfyUI (Kontext), Oracle 26ai, SSE

---

### Task 1: 장소 앵글 프리셋

**Files:**
- Create: `src/locations/services/location-presets.ts`

- [ ] **Step 1: 프리셋 파일 생성**

```typescript
/**
 * @module 장소 앵글 변형 프리셋
 * @description 장소 배경의 다양한 앵글 변형을 위한 Kontext 편집 프롬프트.
 *
 * @author AI Video Factory
 */

export interface LocationPreset {
  label: string;
  angle: string;
  promptSuffix: string;
}

export interface LocationDerivResult {
  refId?: number;
  imagePath: string;
  label: string;
  angle: string;
  prompt: string;
  seed: number;
}

export interface LocationDerivJob {
  jobId: string;
  locationId: string;
  anchorPath: string;
  status: 'preparing' | 'generating' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  currentStep: string;
  results: LocationDerivResult[];
  shouldStop?: boolean;
}

const ROOM_IDENTITY = 'same room, same furniture layout, same wall colors, same decoration, empty room, no people';

export const LOCATION_PRESETS: LocationPreset[] = [
  {
    label: '정면 전체',
    angle: 'front',
    promptSuffix: `${ROOM_IDENTITY}, front view, wide angle, showing full room layout`,
  },
  {
    label: '좌측 회전',
    angle: 'left',
    promptSuffix: `${ROOM_IDENTITY}, camera rotated slightly to the left, showing more of the left wall`,
  },
  {
    label: '우측 회전',
    angle: 'right',
    promptSuffix: `${ROOM_IDENTITY}, camera rotated slightly to the right, showing more of the right wall`,
  },
  {
    label: '역방향',
    angle: 'reverse',
    promptSuffix: `${ROOM_IDENTITY}, camera is now at the back of the room looking toward the entrance door, reverse angle`,
  },
  {
    label: '대각선',
    angle: 'diagonal',
    promptSuffix: `${ROOM_IDENTITY}, camera in the corner looking diagonally across the room`,
  },
  {
    label: '위에서 내려다보기',
    angle: 'high',
    promptSuffix: `${ROOM_IDENTITY}, high angle shot looking down, bird's eye perspective`,
  },
  {
    label: '아래에서 올려다보기',
    angle: 'low_up',
    promptSuffix: `${ROOM_IDENTITY}, low angle shot looking up, dramatic perspective from below`,
  },
  {
    label: '낮은 앵글',
    angle: 'low',
    promptSuffix: `${ROOM_IDENTITY}, floor level low angle, showing furniture from ground perspective`,
  },
  {
    label: '창문 클로즈업',
    angle: 'closeup_window',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the window area, showing window frame and curtains, same lighting`,
  },
  {
    label: '벽면 클로즈업',
    angle: 'closeup_wall',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the main wall feature, showing wall details and decorations`,
  },
  {
    label: '가구 클로즈업',
    angle: 'closeup_furniture',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the main furniture piece, detailed texture, same style`,
  },
  {
    label: '입구 클로즈업',
    angle: 'closeup_entrance',
    promptSuffix: `${ROOM_IDENTITY}, close-up of the door and entrance area, showing doorframe details`,
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/services/location-presets.ts
git commit -m "feat: add location angle variation presets"
```

---

### Task 2: 장소 변형 생성 서비스

**Files:**
- Create: `src/locations/services/location-derivative-generator.ts`

- [ ] **Step 1: 서비스 파일 생성**

```typescript
/**
 * @module 장소 앵글 변형 생성 서비스
 * @description 앵커 배경에서 다양한 앵글 변형을 Kontext 편집으로 생성한다.
 *
 * @dependencies comfyui, location-presets, db
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import oracledb from 'oracledb';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { generateJobId } from '../../common/utils/time-utils';
import { logger } from '../../common/logger';
import {
  LOCATION_PRESETS,
  type LocationPreset,
  type LocationDerivResult,
  type LocationDerivJob,
} from './location-presets';

export type { LocationDerivResult, LocationDerivJob };

export const locDerivEvents = new EventEmitter();
locDerivEvents.setMaxListeners(50);

const activeJobs: Map<string, LocationDerivJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/locations');

function emitProgress(job: LocationDerivJob): void {
  locDerivEvents.emit(`job:${job.jobId}`, {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    completed: job.completed,
    currentStep: job.currentStep,
    results: job.results,
  });
}

async function generateOneAngle(
  job: LocationDerivJob,
  preset: LocationPreset,
  outDir: string,
): Promise<LocationDerivResult | null> {
  const seed = Math.floor(Math.random() * 999999999);
  job.currentStep = `${preset.label} 생성 중... (${job.completed + 1}/${job.total})`;
  emitProgress(job);

  await comfyuiClient.connect();
  const anchorName = await comfyuiClient.uploadImage(job.anchorPath);
  const workflow = buildKontextEditWorkflow({
    anchorImageName: anchorName,
    editPrompt: preset.promptSuffix,
    seed,
    filenamePrefix: `${job.locationId}_${preset.angle}_${seed}`,
  });
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI 결과 없음');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const resp = await fetch(imageUrl);
  const buf = Buffer.from(await resp.arrayBuffer());
  const filename = `${job.locationId}_${preset.angle}_${seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, buf);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), await createThumbnail(buf));

  const conn = await getConnection();
  let refId: number | undefined;
  try {
    const r = await conn.execute(
      `INSERT INTO location_ref_images (location_id, image_path, angle, approved)
       VALUES (:locationId, :imagePath, :angle, 1)
       RETURNING ref_id INTO :refId`,
      {
        locationId: job.locationId,
        imagePath,
        angle: preset.angle,
        refId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const out = r.outBinds as unknown as { refId: number[] };
    refId = out.refId[0];
  } finally {
    await conn.close();
  }

  return { refId, imagePath, label: preset.label, angle: preset.angle, prompt: preset.promptSuffix, seed };
}

export function startLocDerivativeGeneration(
  locationId: string,
  anchorPath: string,
): string {
  const jobId = generateJobId('locderiv');
  const job: LocationDerivJob = {
    jobId,
    locationId,
    anchorPath,
    status: 'preparing',
    total: LOCATION_PRESETS.length,
    completed: 0,
    currentStep: '준비 중...',
    results: [],
  };
  activeJobs.set(jobId, job);
  logger.info('장소 변형 생성 시작', { jobId, locationId });

  const outDir = path.join(EXPORTS_BASE, locationId, jobId);
  processLoop(job, outDir).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('장소 변형 생성 실패', { jobId, error: msg });
    job.status = 'failed';
    job.currentStep = `실패: ${msg}`;
    emitProgress(job);
  });

  return jobId;
}

export function getLocDerivJob(jobId: string): LocationDerivJob | undefined {
  return activeJobs.get(jobId);
}

export function stopLocDerivGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  return true;
}

async function processLoop(job: LocationDerivJob, outDir: string): Promise<void> {
  await ensureDir(outDir);

  // 이전 ref_images 정리
  const conn = await getConnection();
  try {
    await conn.execute(
      'DELETE FROM location_ref_images WHERE location_id = :lid',
      { lid: job.locationId },
      { autoCommit: true },
    );
  } finally {
    await conn.close();
  }

  // 이전 파일 정리
  const parentDir = path.join(EXPORTS_BASE, job.locationId);
  if (fs.existsSync(parentDir)) {
    for (const d of fs.readdirSync(parentDir).filter((x) => x !== job.jobId)) {
      const fp = path.join(parentDir, d);
      if (fs.statSync(fp).isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
    }
  }

  job.status = 'generating';
  for (const preset of LOCATION_PRESETS) {
    if (job.shouldStop) {
      job.status = 'stopped';
      job.currentStep = `중단됨 — ${job.completed}/${job.total}`;
      emitProgress(job);
      return;
    }
    try {
      const result = await generateOneAngle(job, preset, outDir);
      if (result) job.results.push(result);
    } catch (err: unknown) {
      logger.error('앵글 변형 실패', { label: preset.label, error: String(err) });
    }
    job.completed += 1;
    emitProgress(job);
  }
  job.status = 'completed';
  job.currentStep = `완료! ${job.results.length}/${job.total}장`;
  emitProgress(job);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/services/location-derivative-generator.ts
git commit -m "feat: add location angle variation generation service"
```

---

### Task 3: 변형 라우트 + 앵커 확정 시 자동 시작

**Files:**
- Create: `src/locations/routes/location-derivative-routes.ts`
- Modify: `src/locations/routes/location-routes.ts` (앵커 확정 시 변형 자동 시작)

- [ ] **Step 1: 변형 라우트 파일 생성**

```typescript
/**
 * @module 장소 변형 SSE/조회 라우터
 * @description 장소 앵글 변형 생성 SSE 스트리밍, 중단, 재생성 API.
 *
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  getLocDerivJob,
  locDerivEvents,
  stopLocDerivGeneration,
} from '../services/location-derivative-generator';
import {
  LIST_LOC_REF_IMAGES,
  GET_LOC_ANCHOR_PATH,
  COUNT_LOC_REF_IMAGES,
} from '../../db/queries/location-queries';
import type { LocRefImageRow } from '../../db/queries/location-queries';
import {
  LOCATION_PRESETS,
  type LocationPreset,
} from '../services/location-presets';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import oracledb from 'oracledb';

const router = Router();

// ─── SSE: 변형 진행률 ────────────────────────────────────

router.get('/derivatives/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getLocDerivJob(jobId);
  if (!job) { res.status(404).json({ error: '작업 없음' }); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({
    jobId: job.jobId, status: job.status, total: job.total,
    completed: job.completed, currentStep: job.currentStep, results: job.results,
  })}\n\n`);

  const onProgress = (data: unknown): void => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
  locDerivEvents.on(`job:${jobId}`, onProgress);
  req.on('close', () => { locDerivEvents.off(`job:${jobId}`, onProgress); });
});

router.post(
  '/derivatives/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const stopped = stopLocDerivGeneration(String(req.params.jobId));
    if (!stopped) { res.status(404).json({ success: false, error: '작업 없음' }); return; }
    res.json({ success: true });
  }),
);

// ─── 갤러리 API ──────────────────────────────────────────

router.get(
  '/:locationId/ref-images',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const conn = await getConnection();
    try {
      const result = await conn.execute<LocRefImageRow>(
        LIST_LOC_REF_IMAGES, { locationId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const rows = result.rows ?? [];
      res.json({
        success: true,
        data: rows.map((r) => ({
          refId: r.REF_ID, locationId: r.LOCATION_ID, imagePath: r.IMAGE_PATH,
          angle: r.ANGLE, approved: r.APPROVED === 1, createdAt: r.CREATED_AT,
        })),
      });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 재생성 API ──────────────────────────────────────────

router.post(
  '/ref-images/:refId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const refId = Number(req.params.refId);
    const { modifyPrompt } = req.body as { modifyPrompt?: string };

    const conn = await getConnection();
    try {
      const r = await conn.execute<LocRefImageRow>(
        'SELECT * FROM location_ref_images WHERE ref_id = :refId',
        { refId }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const ref = r.rows?.[0];
      if (!ref) { res.status(404).json({ success: false, error: '이미지 없음' }); return; }

      const anchorR = await conn.execute<{ IMAGE_PATH: string }>(
        GET_LOC_ANCHOR_PATH, { locationId: ref.LOCATION_ID }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const anchorPath = anchorR.rows?.[0]?.IMAGE_PATH;
      if (!anchorPath) { res.status(400).json({ success: false, error: '앵커 없음' }); return; }

      const preset = LOCATION_PRESETS.find((p) => p.angle === ref.ANGLE);
      if (!preset) { res.status(400).json({ success: false, error: '프리셋 없음' }); return; }

      // 기존 파일 삭제
      if (ref.IMAGE_PATH && fs.existsSync(ref.IMAGE_PATH)) fs.unlinkSync(ref.IMAGE_PATH);
      const thumbP = path.join(path.dirname(ref.IMAGE_PATH), `thumb_${path.basename(ref.IMAGE_PATH)}`);
      if (fs.existsSync(thumbP)) fs.unlinkSync(thumbP);

      const editPrompt = modifyPrompt
        ? `${preset.promptSuffix} Additionally: ${modifyPrompt}`
        : preset.promptSuffix;

      const seed = Math.floor(Math.random() * 999999999);
      await comfyuiClient.connect();
      const anchorName = await comfyuiClient.uploadImage(anchorPath);
      const wf = buildKontextEditWorkflow({
        anchorImageName: anchorName, editPrompt, seed,
        filenamePrefix: `${ref.LOCATION_ID}_${preset.angle}_${seed}`,
      });
      const pid = await comfyuiClient.submitWorkflow(wf);
      const images = await comfyuiClient.waitForResult(pid, 300_000);
      if (images.length === 0) { res.status(500).json({ success: false, error: '생성 실패' }); return; }

      const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
      const buf = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
      const outDir = path.dirname(ref.IMAGE_PATH);
      await ensureDir(outDir);
      const filename = `${ref.LOCATION_ID}_${preset.angle}_${seed}.png`;
      const imagePath = path.join(outDir, filename);
      await writeFileBuffer(imagePath, buf);
      await writeFileBuffer(path.join(outDir, `thumb_${filename}`), await createThumbnail(buf));

      // DB: 기존 삭제 + 새 레코드
      await conn.execute('DELETE FROM location_ref_images WHERE ref_id = :refId', { refId }, { autoCommit: true });
      const ins = await conn.execute(
        `INSERT INTO location_ref_images (location_id, image_path, angle, approved)
         VALUES (:lid, :ip, :angle, 1) RETURNING ref_id INTO :newId`,
        { lid: ref.LOCATION_ID, ip: imagePath, angle: preset.angle,
          newId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
        { autoCommit: true },
      );
      const newRefId = (ins.outBinds as unknown as { newId: number[] }).newId[0];

      res.json({ success: true, result: { refId: newRefId, imagePath, label: preset.label, angle: preset.angle, seed } });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
```

- [ ] **Step 2: location-routes.ts에서 변형 라우트 마운트 + 앵커 확정 시 변형 자동 시작**

`location-routes.ts` 상단에 import 추가:
```typescript
import locationDerivativeRoutes from './location-derivative-routes';
import { startLocDerivativeGeneration } from '../services/location-derivative-generator';
```

마운트 추가 (기존 `router.use('/', locationCandidateRoutes);` 뒤에):
```typescript
router.use('/', locationDerivativeRoutes);
```

앵커 확정 라우트(`POST /candidates/:jobId/anchor`)에서 응답 부분을 수정 — `anchor_set` 업데이트 후 변형 생성 자동 시작:

기존:
```typescript
      res.json({ success: true });
```

변경:
```typescript
      let derivJobId: string | null = null;
      if (anchor) {
        derivJobId = startLocDerivativeGeneration(anchor.LOCATION_ID, anchor.IMAGE_PATH);
      }
      res.json({ success: true, derivativeJobId: derivJobId });
```

- [ ] **Step 3: Commit**

```bash
git add src/locations/routes/location-derivative-routes.ts src/locations/routes/location-routes.ts
git commit -m "feat: add location derivative routes and auto-start on anchor"
```

---

### Task 4: 변형 검수 + 갤러리 페이지 라우트

**Files:**
- Modify: `src/web/routes/web-routes.ts`

- [ ] **Step 1: 라우트 추가**

`/locations/candidates/:jobId` 라우트 뒤에 추가:

```typescript
router.get('/locations/derivatives/:jobId', (req: Request, res: Response) => {
  res.render('locations/derivatives', { title: '장소 변형 검수', jobId: req.params.jobId });
});

router.get('/locations/:locationId/gallery', (req: Request, res: Response) => {
  res.render('locations/gallery', { title: '장소 갤러리', locationId: req.params.locationId });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/web/routes/web-routes.ts
git commit -m "feat: add location derivative and gallery page routes"
```

---

### Task 5: 변형 검수 페이지

**Files:**
- Create: `src/web/views/locations/derivatives.ejs`

- [ ] **Step 1: 페이지 생성**

캐릭터 derivatives.ejs와 동일한 패턴. SSE로 진행률 표시, 이미지 그리드, 클릭 시 모달+재생성. 차이점: charId 대신 locationId 사용, 라벨에 angle 표시.

API 엔드포인트:
- SSE: `GET /api/locations/derivatives/{jobId}/stream`
- 중단: `POST /api/locations/derivatives/{jobId}/stop`

진행 바, 통계, 로그, 결과 그리드, 모달+재생성 포함. 캐릭터 derivatives.ejs 파일을 읽고 locationId로 치환하여 만들 것. 특히:
- 제목: "장소 앵글 변형 생성"
- 통계에서 "유사 확보" 대신 "생성 완료"
- `face_similarity` 관련 부분 제거
- 재생성 API: `POST /api/locations/ref-images/{refId}/regenerate` (result에서 refId 사용)

앵커 확정 후 이 페이지로 리다이렉트되므로, candidates.ejs의 앵커 확정 성공 시 `window.location.href = '/locations/derivatives/' + json.derivativeJobId;` 로 이동해야 한다.

- [ ] **Step 2: candidates.ejs 수정 — 앵커 확정 후 변형 페이지로 이동**

candidates.ejs의 앵커 확정 성공 핸들러에서:
```javascript
if (json.success) {
  btn.textContent = '확정 완료!';
  // ...
}
```
를 다음으로 교체:
```javascript
if (json.success && json.derivativeJobId) {
  window.location.href = '/locations/derivatives/' + encodeURIComponent(json.derivativeJobId);
} else if (json.success) {
  btn.textContent = '확정 완료!';
  btn.className = 'bg-green-600 text-white text-sm font-semibold px-6 py-3 rounded-lg';
}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/views/locations/derivatives.ejs src/web/views/locations/candidates.ejs
git commit -m "feat: add location derivative inspection page"
```

---

### Task 6: 장소 갤러리 페이지

**Files:**
- Create: `src/web/views/locations/gallery.ejs`

- [ ] **Step 1: 갤러리 페이지 생성**

캐릭터 gallery.ejs와 동일한 패턴이되 locationId 사용:
- API: `GET /api/locations/{locationId}/ref-images`
- 재생성: `POST /api/locations/ref-images/{refId}/regenerate`
- 이미지 그리드, 모달, 재생성 입력, LoRA 학습 버튼(disabled)

- [ ] **Step 2: Commit**

```bash
git add src/web/views/locations/gallery.ejs
git commit -m "feat: add location gallery page"
```

---

### Task 7: 빌드 확인

- [ ] **Step 1: TypeScript 컴파일**

Run: `npx tsc --noEmit`
Expected: 에러 없음
