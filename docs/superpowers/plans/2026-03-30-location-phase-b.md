# 장소 Phase B: 배경 후보 생성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FLUX txt2img로 장소 배경 후보를 30~50장 생성하고, 사용자가 앵커를 선택할 수 있는 UI를 구축한다.

**Architecture:** 캐릭터 후보 생성과 동일한 패턴(인메모리 job → SSE 스트리밍 → DB 저장)을 따르되, 장소는 프롬프트 기반 txt2img만 사용하므로 PuLID 관련 코드가 없다. `buildKontextAnchorWorkflow`를 그대로 사용하되 장소용 해상도 옵션(1536x1024)을 지원한다.

**Tech Stack:** Express, EJS, ComfyUI (FLUX), Oracle 26ai, oracledb, SSE

---

## 파일 구조

```
src/locations/
  services/
    location-candidate-generator.ts — 후보 생성 서비스 (job 관리 + 배치 처리)
  routes/
    location-candidate-routes.ts    — SSE 스트리밍 + 생성 시작/중단 API
src/web/views/locations/
    candidates.ejs                   — 후보 선택 페이지
```

---

### Task 1: 장소 후보 생성 서비스

**Files:**
- Create: `src/locations/services/location-candidate-generator.ts`

- [ ] **Step 1: 서비스 파일 생성**

```typescript
/**
 * @module 장소 배경 후보 생성 서비스
 * @description 프롬프트로 FLUX txt2img 배경 이미지를 배치 생성한다.
 *
 * @dependencies comfyui, location-queries, db
 * @author AI Video Factory
 */

import path from 'path';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextAnchorWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { getConnection } from '../../db/connection';
import { findLocationById, insertLocCandidate } from '../../db/queries/location-queries';
import { scoreImage } from '../../python-api/endpoints/quality-api';
import { generateJobId } from '../../common/utils/time-utils';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';
import { logger } from '../../common/logger';

// ─── 인터페이스 ─────────────────────────────────────────

export interface LocCandidateResult {
  candidateId?: number;
  imagePath: string;
  prompt: string;
  seed: number;
  qualityScore?: number;
  grade?: string;
}

export interface LocGenerationJob {
  jobId: string;
  locationId: string;
  status: 'generating' | 'scoring' | 'completed' | 'failed' | 'stopped';
  total: number;
  completed: number;
  candidates: LocCandidateResult[];
  lastError?: string;
  shouldStop?: boolean;
}

// ─── 인메모리 작업 관리 ──────────────────────────────────

const activeJobs: Map<string, LocGenerationJob> = new Map();
const EXPORTS_BASE = path.resolve('exports/locations');

const EMPTY_ROOM_SUFFIX =
  ', empty room, no people, no characters, unoccupied, photorealistic, 8k, detailed interior photography';

function buildLocPrompts(
  promptBase: string,
  count: number,
): { prompt: string; seed: number }[] {
  const variations = [
    '',
    ', wide angle shot',
    ', centered composition',
    ', natural lighting from windows',
    ', warm ambient lighting',
    ', slightly different angle',
    ', soft shadows, even lighting',
    ', clear details on walls and floor',
    ', showing full room layout',
    ', detailed textures on furniture',
  ];
  return Array.from({ length: count }, (_, i) => ({
    prompt: promptBase + (variations[i % variations.length] || '') + EMPTY_ROOM_SUFFIX,
    seed: Math.floor(Math.random() * 999999999),
  }));
}

// ─── 공개 API ───────────────────────────────────────────

export async function startLocCandidateGeneration(
  locationId: string,
  count: number,
  customPrompt?: string,
  width?: number,
  height?: number,
): Promise<string> {
  let promptBase = customPrompt ?? '';

  if (!promptBase) {
    const conn = await getConnection();
    try {
      const loc = await findLocationById(conn, locationId);
      if (!loc) throw new Error(`장소를 찾을 수 없습니다: ${locationId}`);
      promptBase = loc.PROMPT_BASE ?? '';
    } finally {
      await conn.close();
    }
  }
  if (!promptBase) throw new Error('프롬프트가 없습니다. promptBase를 등록해주세요.');

  const prompts = buildLocPrompts(promptBase, count);
  const jobId = generateJobId('loc');
  const job: LocGenerationJob = {
    jobId,
    locationId,
    status: 'generating',
    total: prompts.length,
    completed: 0,
    candidates: [],
  };

  activeJobs.set(jobId, job);
  logger.info('장소 후보 생성 시작', { jobId, locationId, count: prompts.length });

  processBatch(job, prompts, width ?? 1024, height ?? 1024).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('장소 후보 배치 생성 실패', { jobId, error: message });
    job.status = 'failed';
    job.lastError = message;
  });

  return jobId;
}

export function getLocJob(jobId: string): LocGenerationJob | undefined {
  return activeJobs.get(jobId);
}

export function stopLocCandidateGeneration(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.shouldStop = true;
  logger.info('장소 후보 생성 중단 요청', { jobId });
  return true;
}

// ─── 내부 배치 처리 ─────────────────────────────────────

function assignGrade(score: number): string {
  if (score >= 0.9) return 'S';
  if (score >= 0.8) return 'A';
  if (score >= 0.7) return 'B';
  return 'C';
}

async function processOneLocCandidate(
  job: LocGenerationJob,
  promptItem: { prompt: string; seed: number },
  outDir: string,
  width: number,
  height: number,
): Promise<void> {
  await comfyuiClient.connect();

  const workflow = buildKontextAnchorWorkflow({
    prompt: promptItem.prompt,
    seed: promptItem.seed,
    width,
    height,
    filenamePrefix: `${job.locationId}_${promptItem.seed}`,
  });

  const promptId = await comfyuiClient.submitWorkflow(workflow);
  const images = await comfyuiClient.waitForResult(promptId, 300_000);
  if (images.length === 0) throw new Error('ComfyUI에서 이미지 결과를 받지 못했습니다');

  const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `${job.locationId}_${promptItem.seed}.png`;
  const imagePath = path.join(outDir, filename);
  await writeFileBuffer(imagePath, imageBuffer);
  const thumbnail = await createThumbnail(imageBuffer);
  await writeFileBuffer(path.join(outDir, `thumb_${filename}`), thumbnail);

  const candidate: LocCandidateResult = {
    imagePath,
    prompt: promptItem.prompt,
    seed: promptItem.seed,
  };

  job.status = 'scoring';
  try {
    const scoreResult = await scoreImage(imagePath);
    if (scoreResult.success && scoreResult.data) {
      candidate.qualityScore = scoreResult.data.score;
      candidate.grade = assignGrade(scoreResult.data.score);
    }
  } catch (scoreErr: unknown) {
    const msg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
    logger.warn('품질 평가 실패 (건너뜀)', { jobId: job.jobId, error: msg });
  }

  const conn = await getConnection();
  try {
    const candidateId = await insertLocCandidate(conn, {
      locationId: job.locationId,
      jobId: job.jobId,
      imagePath,
      promptText: promptItem.prompt,
      seed: promptItem.seed,
    });
    candidate.candidateId = candidateId;
  } finally {
    await conn.close();
  }

  job.candidates.push(candidate);
  job.completed += 1;
  job.status = 'generating';
  logger.debug('장소 후보 생성 완료', {
    jobId: job.jobId,
    progress: `${job.completed}/${job.total}`,
  });
}

async function processBatch(
  job: LocGenerationJob,
  prompts: { prompt: string; seed: number }[],
  width: number,
  height: number,
): Promise<void> {
  const outDir = path.join(EXPORTS_BASE, job.locationId, job.jobId);
  await ensureDir(outDir);

  for (const promptItem of prompts) {
    if (job.shouldStop) {
      job.status = 'stopped';
      logger.info('장소 후보 생성 중단', { jobId: job.jobId, completed: job.completed });
      break;
    }
    try {
      await processOneLocCandidate(job, promptItem, outDir, width, height);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.lastError = msg;
      logger.error('장소 개별 후보 생성 실패', { jobId: job.jobId, error: msg });
      if (job.completed === 0) {
        job.status = 'failed';
        return;
      }
    }
  }

  if (job.status === 'generating') {
    job.status = 'completed';
    logger.info('장소 후보 생성 완료', { jobId: job.jobId, total: job.completed });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/services/location-candidate-generator.ts
git commit -m "feat: add location candidate generation service"
```

---

### Task 2: 장소 후보 라우트 (SSE + 생성 시작)

**Files:**
- Create: `src/locations/routes/location-candidate-routes.ts`
- Modify: `src/locations/routes/location-routes.ts`

- [ ] **Step 1: 후보 라우트 파일 생성**

```typescript
/**
 * @module 장소 후보 SSE/생성 라우터
 * @description 장소 배경 후보 생성 시작, SSE 스트리밍, 중단 API.
 *
 * @dependencies express, location-candidate-generator, location-queries, db
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { listLocCandidatesByJob } from '../../db/queries/location-queries';
import {
  startLocCandidateGeneration,
  getLocJob,
  stopLocCandidateGeneration,
} from '../services/location-candidate-generator';

const router = Router();

// ─── 후보 생성 시작 ─────────────────────────────────────

router.post(
  '/generate-candidates',
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const locationId = body.locationId as string | undefined;
    const count = Number(body.count ?? 30);
    const customPrompt = (body.customPrompt as string) || undefined;
    const width = Number(body.width ?? 1024);
    const height = Number(body.height ?? 1024);

    if (!locationId) {
      res.status(400).json({ success: false, error: 'locationId는 필수입니다' });
      return;
    }

    const jobId = await startLocCandidateGeneration(
      locationId, count, customPrompt, width, height,
    );
    res.json({ success: true, jobId });
  }),
);

// ─── SSE: 후보 생성 실시간 ──────────────────────────────

router.get(
  '/candidates/:jobId/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getLocJob(jobId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!job) {
      const conn = await getConnection();
      try {
        const rows = await listLocCandidatesByJob(conn, jobId);
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
        const locationId = rows[0]?.LOCATION_ID ?? '';
        res.write(
          `data: ${JSON.stringify({
            jobId,
            locationId,
            status: 'completed',
            total: rows.length,
            completed: rows.length,
            candidates,
          })}\n\n`,
        );
      } finally {
        await conn.close();
      }
      res.end();
      return;
    }

    const sendState = (): void => {
      res.write(
        `data: ${JSON.stringify({
          jobId: job.jobId,
          locationId: job.locationId,
          status: job.status,
          total: job.total,
          completed: job.completed,
          candidates: job.candidates,
        })}\n\n`,
      );
    };

    sendState();
    const timer = setInterval(() => {
      sendState();
      if (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'stopped'
      ) {
        clearInterval(timer);
        res.end();
      }
    }, 2000);

    req.on('close', () => {
      clearInterval(timer);
    });
  }),
);

// ─── 후보 생성 중단 ────────────────────────────────────

router.post(
  '/candidates/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const stopped = stopLocCandidateGeneration(jobId);
    if (!stopped) {
      res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
      return;
    }
    res.json({ success: true, message: '장소 후보 생성 중단 요청 완료' });
  }),
);

export default router;
```

- [ ] **Step 2: location-routes.ts에서 candidate 라우트 마운트**

`src/locations/routes/location-routes.ts` 파일 상단에 import 추가:

```typescript
import locationCandidateRoutes from './location-candidate-routes';
```

`export default router;` 직전에 마운트:

```typescript
router.use('/', locationCandidateRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add src/locations/routes/location-candidate-routes.ts src/locations/routes/location-routes.ts
git commit -m "feat: add location candidate SSE and generation routes"
```

---

### Task 3: 후보 선택 페이지 라우트 등록

**Files:**
- Modify: `src/web/routes/web-routes.ts`

- [ ] **Step 1: 후보 페이지 라우트 추가**

`web-routes.ts`에서 `/locations` 라우트 바로 뒤에 추가:

```typescript
router.get('/locations/candidates/:jobId', (req: Request, res: Response) => {
  res.render('locations/candidates', { title: '장소 후보 선택', jobId: req.params.jobId });
});
```

주의: 이 라우트를 `/locations` 라우트 뒤, **`/locations`가 아닌 에피소드 라우트 앞에** 배치해야 한다. 그리고 `/locations/candidates/:jobId` 라우트는 반드시 `/locations` 뒤에 있어야 Express가 정확히 매칭한다.

- [ ] **Step 2: Commit**

```bash
git add src/web/routes/web-routes.ts
git commit -m "feat: add location candidates page route"
```

---

### Task 4: 후보 선택 페이지 (candidates.ejs)

**Files:**
- Create: `src/web/views/locations/candidates.ejs`

- [ ] **Step 1: 후보 선택 뷰 생성**

```html
<div>
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h2 class="text-3xl font-headline font-extrabold text-[#e5e1e4]">장소 배경 후보</h2>
      <p class="text-xs text-[#ccc3d8] mt-1">작업: <span class="text-[#d2bbff]"><%= jobId %></span></p>
    </div>
    <div class="flex gap-2">
      <button id="btn-stop" class="bg-red-500/20 hover:bg-red-500/40 text-red-400 text-sm px-4 py-2 rounded-lg transition hidden">중단</button>
      <a href="/locations" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-4 py-2 rounded-lg transition">목록으로</a>
    </div>
  </div>

  <!-- 진행률 -->
  <div id="progress-area" class="mb-6">
    <div class="flex items-center gap-3">
      <div class="flex-1 h-2 bg-[#353437] rounded-full overflow-hidden">
        <div id="progress-bar" class="h-full bg-[#7c3aed] rounded-full transition-all" style="width:0%"></div>
      </div>
      <span id="progress-text" class="text-sm text-[#ccc3d8] w-20 text-right">0 / 0</span>
    </div>
    <p id="status-text" class="text-xs text-[#958da1] mt-2">연결 중...</p>
  </div>

  <!-- 카드 그리드 -->
  <div id="grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"></div>

  <!-- 앵커 설정 영역 -->
  <div id="anchor-area" class="mt-8 hidden">
    <p class="text-sm text-[#ccc3d8] mb-3">기준 배경으로 사용할 이미지를 클릭한 뒤 아래 버튼을 누르세요.</p>
    <button id="btn-anchor" disabled class="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-semibold px-6 py-3 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">선택한 이미지를 기준 배경으로 확정</button>
  </div>

  <!-- 이미지 모달 -->
  <div id="img-modal" class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center hidden">
    <div class="relative max-w-[85vw] max-h-[90vh] flex flex-col items-center">
      <img id="modal-img" class="max-w-full max-h-[70vh] rounded-lg shadow-2xl" src="" alt="">
      <div class="mt-3 flex gap-4 text-sm text-[#ccc3d8]">
        <span>Seed: <span id="modal-seed" class="text-[#d2bbff]"></span></span>
        <span>등급: <span id="modal-grade" class="text-[#4ade80]"></span></span>
      </div>
      <button id="modal-close" class="mt-4 bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-6 py-2 rounded-lg transition">닫기</button>
    </div>
  </div>
</div>

<script src="/js/characters.js"></script>
<script>
(function() {
  var JOB_ID = '<%= jobId %>';
  var selectedCandidateId = null;
  var candidates = [];

  function createCard(c) {
    var card = document.createElement('div');
    card.className = 'bg-[#2a2a2c] rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#7c3aed] transition relative';
    card.dataset.candidateId = String(c.candidateId || 0);

    var imgWrap = document.createElement('div');
    imgWrap.className = 'aspect-[4/3] bg-[#353437] flex items-center justify-center';
    if (c.imagePath) {
      var img = document.createElement('img');
      img.src = thumbUrl(c.imagePath);
      img.alt = 'candidate';
      img.className = 'w-full h-full object-cover';
      img.loading = 'lazy';
      imgWrap.appendChild(img);
    }
    card.appendChild(imgWrap);

    var info = document.createElement('div');
    info.className = 'p-2 flex items-center justify-between';

    if (c.grade) {
      var gradeEl = document.createElement('span');
      var gradeColors = { S: 'text-yellow-400', A: 'text-green-400', B: 'text-blue-400', C: 'text-gray-400' };
      gradeEl.className = 'text-xs font-bold ' + (gradeColors[c.grade] || 'text-gray-400');
      gradeEl.textContent = c.grade;
      info.appendChild(gradeEl);
    }

    var seedEl = document.createElement('span');
    seedEl.className = 'text-[10px] text-[#958da1]';
    seedEl.textContent = c.seed || '';
    info.appendChild(seedEl);
    card.appendChild(info);

    // 클릭: 선택 상태 토글
    card.addEventListener('click', function(e) {
      // 더블클릭은 모달
      if (e.detail >= 2) {
        document.getElementById('modal-img').src = pathToUrl(c.imagePath);
        document.getElementById('modal-seed').textContent = c.seed || '';
        document.getElementById('modal-grade').textContent = c.grade || '-';
        document.getElementById('img-modal').classList.remove('hidden');
        return;
      }
      // 싱글클릭: 선택
      document.querySelectorAll('#grid > div').forEach(function(el) { el.classList.remove('ring-2', 'ring-green-400'); });
      card.classList.add('ring-2', 'ring-green-400');
      selectedCandidateId = c.candidateId;
      document.getElementById('btn-anchor').disabled = false;
    });

    return card;
  }

  function updateGrid(data) {
    var grid = document.getElementById('grid');
    // 새로 추가된 후보만 렌더링
    var existing = grid.children.length;
    var all = data.candidates || [];
    for (var i = existing; i < all.length; i++) {
      grid.appendChild(createCard(all[i]));
    }
    candidates = all;
  }

  function updateProgress(data) {
    var pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-text').textContent = data.completed + ' / ' + data.total;

    var statusMap = {
      generating: '생성 중...',
      scoring: '품질 평가 중...',
      completed: '완료',
      failed: '실패',
      stopped: '중단됨',
    };
    document.getElementById('status-text').textContent = statusMap[data.status] || data.status;

    if (data.status === 'generating' || data.status === 'scoring') {
      document.getElementById('btn-stop').classList.remove('hidden');
    }
    if (data.status === 'completed' || data.status === 'stopped') {
      document.getElementById('btn-stop').classList.add('hidden');
      document.getElementById('anchor-area').classList.remove('hidden');
    }
  }

  // SSE 스트리밍
  var evtSource = new EventSource('/api/locations/candidates/' + JOB_ID + '/stream');
  evtSource.onmessage = function(e) {
    try {
      var data = JSON.parse(e.data);
      updateProgress(data);
      updateGrid(data);
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'stopped') {
        evtSource.close();
      }
    } catch (err) { /* ignore parse errors */ }
  };
  evtSource.onerror = function() {
    document.getElementById('status-text').textContent = '연결 끊김. 새로고침해주세요.';
    evtSource.close();
  };

  // 중단 버튼
  document.getElementById('btn-stop').addEventListener('click', function() {
    fetch('/api/locations/candidates/' + JOB_ID + '/stop', { method: 'POST' });
  });

  // 모달 닫기
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('img-modal').classList.add('hidden');
  });
  document.getElementById('img-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });

  // 앵커 확정
  document.getElementById('btn-anchor').addEventListener('click', async function() {
    if (!selectedCandidateId) return;
    var btn = document.getElementById('btn-anchor');
    btn.disabled = true;
    btn.textContent = '확정 중...';

    try {
      var res = await fetch('/api/locations/candidates/' + JOB_ID + '/anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchorCandidateId: selectedCandidateId }),
      });
      var json = await res.json();
      if (json.success) {
        btn.textContent = '확정 완료!';
        btn.className = 'bg-green-600 text-white text-sm font-semibold px-6 py-3 rounded-lg';
        // Phase C에서 파생 생성 자동 시작 연동 예정
        // 지금은 갤러리로 이동 없이 완료 표시만
      } else {
        alert('앵커 확정 실패: ' + (json.error || ''));
        btn.disabled = false;
        btn.textContent = '선택한 이미지를 기준 배경으로 확정';
      }
    } catch (err) {
      alert('요청 실패: ' + err.message);
      btn.disabled = false;
      btn.textContent = '선택한 이미지를 기준 배경으로 확정';
    }
  });
})();
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/web/views/locations/candidates.ejs
git commit -m "feat: add location candidate selection page"
```

---

### Task 5: manage.ejs "후보 생성" 버튼 연결

**Files:**
- Modify: `src/web/views/locations/manage.ejs`

- [ ] **Step 1: 후보 생성 버튼 핸들러 구현**

manage.ejs에서 "후보 생성" 버튼의 `addEventListener`를 찾아서, `alert('Phase B에서 구현 예정');` 부분을 실제 생성 로직으로 교체:

```javascript
    genBtn.addEventListener('click', async function() {
      genBtn.disabled = true;
      genBtn.textContent = '생성 시작 중...';
      try {
        var res = await fetch('/api/locations/generate-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: loc.LOCATION_ID,
            count: 30,
            width: 1024,
            height: 1024,
          }),
        });
        var json = await res.json();
        if (json.success && json.jobId) {
          window.location.href = '/locations/candidates/' + encodeURIComponent(json.jobId);
        } else {
          alert('후보 생성 실패: ' + (json.error || ''));
          genBtn.disabled = false;
          genBtn.textContent = '후보 생성';
        }
      } catch (err) {
        alert('요청 실패: ' + err.message);
        genBtn.disabled = false;
        genBtn.textContent = '후보 생성';
      }
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/web/views/locations/manage.ejs
git commit -m "feat: connect location candidate generation button"
```

---

### Task 6: 빌드 확인

- [ ] **Step 1: TypeScript 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없이 종료

- [ ] **Step 2: 수동 테스트 체크리스트**

1. `/locations` 페이지에서 장소 등록
2. "후보 생성" 버튼 클릭 → 후보 선택 페이지로 이동
3. SSE 진행률 바가 업데이트되는지
4. 이미지 카드가 생성될 때마다 추가되는지
5. 더블클릭 시 모달에 큰 이미지 표시되는지
6. 싱글클릭 시 녹색 테두리로 선택되는지
7. "기준 배경으로 확정" 버튼이 정상 동작하는지
8. 중단 버튼 클릭 시 생성이 멈추는지
