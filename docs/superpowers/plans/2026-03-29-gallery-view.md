# 파생 이미지 갤러리 뷰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캐릭터별 저장된 파생 이미지를 DB에서 조회하여 갤러리로 보여주고, 개별 이미지 재생성을 지원한다.

**Architecture:** `char_ref_images` 테이블 조회 쿼리를 `character-queries.ts`에 추가하고, 갤러리 API/페이지 라우트를 등록한다. DB 기반 재생성 엔드포인트를 추가하여 인메모리 job 없이도 이미지 교체가 가능하게 한다.

**Tech Stack:** Express, EJS, Oracle 26ai, ComfyUI (Kontext)

---

### Task 1: char_ref_images DB 쿼리 추가

**Files:**
- Modify: `src/db/queries/character-queries.ts`

- [ ] **Step 1: ref_images 조회 SQL 상수 및 타입 추가**

`character-queries.ts` 파일 하단, `updateCharacterAnchor` 함수 위에 다음을 추가:

```typescript
// ─── 파생 이미지(char_ref_images) 쿼리 ─────────────────

export const LIST_REF_IMAGES_BY_CHAR = `
  SELECT ref_id, char_id, image_path, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE char_id = :charId AND approved = 1
   ORDER BY created_at ASC
`;

export const GET_REF_IMAGE = `
  SELECT ref_id, char_id, image_path, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE ref_id = :refId
`;

export const UPDATE_REF_IMAGE_PATH = `
  UPDATE char_ref_images
     SET image_path = :imagePath
   WHERE ref_id = :refId
`;

export const DELETE_REF_IMAGE = `
  DELETE FROM char_ref_images WHERE ref_id = :refId
`;

export const GET_ANCHOR_PATH = `
  SELECT image_path
    FROM char_candidates
   WHERE char_id = :charId AND is_anchor = 1
   FETCH FIRST 1 ROWS ONLY
`;

export interface RefImageRow {
  REF_ID: number;
  CHAR_ID: string;
  IMAGE_PATH: string;
  POSE_TAG: string | null;
  QUALITY_SCORE: number | null;
  APPROVED: number;
  CREATED_AT: Date;
}
```

- [ ] **Step 2: ref_images 쿼리 함수 추가**

같은 파일 하단에 함수 추가:

```typescript
export async function listRefImagesByChar(
  conn: oracledb.Connection,
  charId: string,
): Promise<RefImageRow[]> {
  const result = await conn.execute<RefImageRow>(
    LIST_REF_IMAGES_BY_CHAR,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('파생 이미지 목록 조회', { charId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function getRefImage(
  conn: oracledb.Connection,
  refId: number,
): Promise<RefImageRow | undefined> {
  const result = await conn.execute<RefImageRow>(
    GET_REF_IMAGE,
    { refId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0];
}

export async function getAnchorPath(
  conn: oracledb.Connection,
  charId: string,
): Promise<string | null> {
  const result = await conn.execute<{ IMAGE_PATH: string }>(
    GET_ANCHOR_PATH,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.IMAGE_PATH ?? null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/character-queries.ts
git commit -m "feat: add char_ref_images DB queries for gallery"
```

---

### Task 2: 갤러리 API 엔드포인트 추가

**Files:**
- Modify: `src/characters/routes/character-routes.ts`

- [ ] **Step 1: import 추가**

`character-routes.ts` 상단 import에서 `character-queries` import를 확장:

```typescript
import {
  findCharacterById,
  listCharacters,
  updateCharacterStatus,
  listRefImagesByChar,
} from '../../db/queries/character-queries';
```

- [ ] **Step 2: 파생 이미지 목록 API 추가**

파일 하단 `export default router;` 직전에 추가:

```typescript
// ─── 파생 이미지 갤러리 ───────────────────────────────────────

router.get(
  '/:charId/ref-images',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const conn = await getConnection();
    try {
      const rows = await listRefImagesByChar(conn, charId);
      res.json({
        success: true,
        data: rows.map((r) => ({
          refId: r.REF_ID,
          charId: r.CHAR_ID,
          imagePath: r.IMAGE_PATH,
          poseTag: r.POSE_TAG,
          qualityScore: r.QUALITY_SCORE,
          approved: r.APPROVED === 1,
          createdAt: r.CREATED_AT,
        })),
      });
    } finally {
      await conn.close();
    }
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add src/characters/routes/character-routes.ts
git commit -m "feat: add GET /:charId/ref-images gallery API"
```

---

### Task 3: DB 기반 이미지 재생성 엔드포인트

**Files:**
- Modify: `src/characters/routes/derivative-routes.ts`

- [ ] **Step 1: import 추가**

`derivative-routes.ts` 상단에 추가:

```typescript
import fs from 'fs';
import path from 'path';
import {
  getRefImage,
  getAnchorPath,
  UPDATE_REF_IMAGE_PATH,
  DELETE_REF_IMAGE,
} from '../../db/queries/character-queries';
import { DERIVATIVE_PRESETS } from '../services/derivative-presets';
import type { DerivativePreset } from '../services/derivative-presets';
import { generateOneImage } from '../services/derivative-image';
import { ensureDir } from '../../common/utils/file-utils';
import { buildRegenPrompt } from '../services/derivative-generator';
```

- [ ] **Step 2: DB 기반 재생성 엔드포인트 추가**

기존 `router.post('/derivatives/:jobId/regenerate', ...)` 뒤에 추가:

```typescript
router.post(
  '/ref-images/:refId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const refId = Number(req.params.refId);
    const { modifyPrompt } = req.body as { modifyPrompt?: string };

    const conn = await getConnection();
    try {
      const refImage = await getRefImage(conn, refId);
      if (!refImage) {
        res.status(404).json({ success: false, error: '이미지를 찾을 수 없습니다' });
        return;
      }

      const charId = refImage.CHAR_ID;
      const poseTag = refImage.POSE_TAG ?? '';
      const anchorPath = await getAnchorPath(conn, charId);
      if (!anchorPath) {
        res.status(400).json({ success: false, error: '앵커 이미지를 찾을 수 없습니다' });
        return;
      }

      const preset = DERIVATIVE_PRESETS.find((p) => p.label === poseTag);
      if (!preset) {
        res.status(400).json({ success: false, error: `프리셋을 찾을 수 없습니다: ${poseTag}` });
        return;
      }

      // 기존 파일 삭제
      if (fs.existsSync(refImage.IMAGE_PATH)) fs.unlinkSync(refImage.IMAGE_PATH);
      const thumbPath = path.join(
        path.dirname(refImage.IMAGE_PATH),
        `thumb_${path.basename(refImage.IMAGE_PATH)}`,
      );
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

      // 프롬프트 조합
      const combinedPreset: DerivativePreset = {
        ...preset,
        promptSuffix: buildRegenPrompt(preset.promptSuffix, modifyPrompt ?? ''),
      };

      // 출력 디렉토리: 기존 이미지와 같은 디렉토리
      const outDir = path.dirname(refImage.IMAGE_PATH);
      await ensureDir(outDir);

      // 임시 job 객체 생성 (generateOneImage가 요구)
      const tempJob = {
        jobId: `regen_${refId}`,
        charId,
        anchorPath,
        status: 'generating' as const,
        total: 1,
        completed: 0,
        generated: 0,
        deleted: 0,
        batch: 0,
        currentStep: '',
        results: [],
      };

      const newResult = await generateOneImage(
        tempJob,
        combinedPreset,
        '',
        outDir,
        () => {},
      );
      if (!newResult) {
        res.status(500).json({ success: false, error: '이미지 생성 실패' });
        return;
      }

      // 기존 DB 레코드 삭제 (generateOneImage가 새 레코드를 이미 삽입함)
      await conn.execute(DELETE_REF_IMAGE, { refId }, { autoCommit: true });

      res.json({
        success: true,
        result: {
          refId: newResult.refId,
          imagePath: newResult.imagePath,
          label: newResult.label,
          prompt: newResult.prompt,
          seed: newResult.seed,
        },
      });
    } finally {
      await conn.close();
    }
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add src/characters/routes/derivative-routes.ts
git commit -m "feat: add DB-based ref-image regeneration endpoint"
```

---

### Task 4: 갤러리 페이지 라우트 등록

**Files:**
- Modify: `src/web/routes/web-routes.ts`

- [ ] **Step 1: 갤러리 라우트 추가**

`web-routes.ts`에서 derivatives 라우트 뒤에 추가:

```typescript
router.get('/characters/:charId/gallery', (req: Request, res: Response) => {
  res.render('characters/gallery', { title: '파생 이미지 갤러리', charId: req.params.charId });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/web/routes/web-routes.ts
git commit -m "feat: add gallery page route"
```

---

### Task 5: gallery.ejs 뷰 생성

**Files:**
- Create: `src/web/views/characters/gallery.ejs`

- [ ] **Step 1: 갤러리 뷰 파일 생성**

```html
<div>
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h2 class="text-3xl font-headline font-extrabold text-[#e5e1e4]">파생 이미지 갤러리</h2>
      <p class="text-xs text-[#ccc3d8] mt-1">캐릭터: <span class="text-[#d2bbff]"><%= charId %></span></p>
    </div>
    <a href="/characters" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-4 py-2 rounded-lg transition">목록으로</a>
  </div>

  <!-- 로딩 -->
  <div id="loading" class="text-center py-20 text-[#ccc3d8]">불러오는 중...</div>

  <!-- 빈 상태 -->
  <div id="empty-state" class="text-center py-20 text-[#ccc3d8] hidden">저장된 파생 이미지가 없습니다.</div>

  <!-- 통계 -->
  <div id="stats-bar" class="mb-4 hidden">
    <span class="text-sm text-[#ccc3d8]">총 <span id="stat-count" class="text-[#d2bbff] font-semibold">0</span>장</span>
  </div>

  <!-- 이미지 그리드 -->
  <div id="gallery-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 hidden"></div>

  <!-- 하단 액션 -->
  <div id="bottom-actions" class="mt-8 flex gap-3 hidden">
    <button id="btn-lora" disabled class="bg-[#7c3aed]/40 text-[#d2bbff] text-sm font-semibold px-6 py-3 rounded-lg cursor-not-allowed">
      LoRA 학습 시작 (준비 중)
    </button>
  </div>

  <!-- 이미지 모달 -->
  <div id="img-modal" class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center hidden">
    <div class="relative max-w-[85vw] max-h-[90vh] flex flex-col items-center">
      <img id="img-modal-src" class="max-w-full max-h-[65vh] rounded-lg shadow-2xl" src="" alt="">
      <p id="img-modal-label" class="text-sm text-[#d2bbff] font-semibold mt-3"></p>

      <!-- 수정 프롬프트 입력 -->
      <div class="mt-4 w-full max-w-xl">
        <p class="text-xs text-[#ccc3d8] mb-1">수정 지시 (선택)</p>
        <textarea
          id="img-modal-modify"
          class="w-full bg-[#1b1b1d] border border-[#353437] text-[#e5e1e4] text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#7c3aed]"
          rows="2"
          placeholder="예: 눈을 더 크게 만들어줘, 배경을 파란색으로 바꿔줘..."
        ></textarea>
      </div>

      <div class="mt-3 flex gap-3">
        <button id="modal-regen-btn" class="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm px-5 py-2 rounded-lg transition font-semibold">재생성</button>
        <button id="modal-close" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-6 py-2 rounded-lg transition">닫기</button>
      </div>
    </div>
  </div>
</div>

<script src="/js/characters.js"></script>
<script>
(function() {
  var CHAR_ID = '<%= charId %>';
  var images = [];
  var currentRefId = null;

  function createCard(img) {
    var card = document.createElement('div');
    card.className = 'bg-[#2a2a2c] rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#7c3aed] transition';
    card.dataset.refId = String(img.refId);
    card.dataset.imagePath = img.imagePath || '';

    var imgWrap = document.createElement('div');
    imgWrap.className = 'aspect-[3/4] bg-[#353437] flex items-center justify-center';
    if (img.imagePath) {
      var imgEl = document.createElement('img');
      imgEl.src = thumbUrl(img.imagePath);
      imgEl.alt = img.poseTag || '';
      imgEl.className = 'w-full h-full object-cover';
      imgEl.loading = 'lazy';
      imgWrap.appendChild(imgEl);
    }
    card.appendChild(imgWrap);

    var info = document.createElement('div');
    info.className = 'p-2';
    var labelEl = document.createElement('p');
    labelEl.className = 'text-xs font-semibold text-[#d2bbff]';
    labelEl.textContent = img.poseTag || '(없음)';
    info.appendChild(labelEl);
    card.appendChild(info);

    card.addEventListener('click', function() {
      var imgPath = card.dataset.imagePath;
      if (imgPath) {
        currentRefId = Number(card.dataset.refId);
        document.getElementById('img-modal-src').src = pathToUrl(imgPath);
        document.getElementById('img-modal-label').textContent = img.poseTag || '';
        document.getElementById('img-modal-modify').value = '';
        document.getElementById('img-modal').classList.remove('hidden');
      }
    });

    return card;
  }

  async function loadGallery() {
    try {
      var res = await fetch('/api/characters/' + encodeURIComponent(CHAR_ID) + '/ref-images');
      var json = await res.json();
      images = json.data || [];

      document.getElementById('loading').classList.add('hidden');

      if (images.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
        return;
      }

      document.getElementById('stat-count').textContent = images.length;
      document.getElementById('stats-bar').classList.remove('hidden');
      document.getElementById('bottom-actions').classList.remove('hidden');

      var grid = document.getElementById('gallery-grid');
      grid.classList.remove('hidden');
      grid.textContent = '';
      images.forEach(function(img) { grid.appendChild(createCard(img)); });
    } catch (err) {
      document.getElementById('loading').textContent = '이미지를 불러오지 못했습니다.';
    }
  }

  // 모달 닫기
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('img-modal').classList.add('hidden');
  });
  document.getElementById('img-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });

  // 재생성
  document.getElementById('modal-regen-btn').addEventListener('click', function() {
    if (!currentRefId) return;
    var refId = currentRefId;
    var modifyPrompt = document.getElementById('img-modal-modify').value;

    document.getElementById('img-modal').classList.add('hidden');

    var card = document.querySelector('[data-ref-id="' + refId + '"]');
    if (card) {
      var overlay = document.createElement('div');
      overlay.id = 'regen-overlay-' + refId;
      overlay.className = 'absolute inset-0 bg-black/70 flex items-center justify-center rounded-lg z-10';
      var spinner = document.createElement('span');
      spinner.className = 'animate-spin text-white text-2xl';
      spinner.textContent = '\u25D6';
      overlay.appendChild(spinner);
      card.style.position = 'relative';
      card.appendChild(overlay);
    }

    fetch('/api/characters/ref-images/' + refId + '/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifyPrompt: modifyPrompt })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var ov = document.getElementById('regen-overlay-' + refId);
      if (ov) ov.remove();
      if (data.success && data.result && card) {
        card.dataset.refId = String(data.result.refId);
        card.dataset.imagePath = data.result.imagePath;
        var img = card.querySelector('img');
        if (img) {
          img.src = thumbUrl(data.result.imagePath) + '?t=' + Date.now();
        }
        currentRefId = data.result.refId;
      } else {
        alert('재생성 실패: ' + (data.error || '알 수 없는 오류'));
      }
    })
    .catch(function(err) {
      var ov = document.getElementById('regen-overlay-' + refId);
      if (ov) ov.remove();
      alert('재생성 실패: ' + err.message);
    });
  });

  loadGallery();
})();
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/web/views/characters/gallery.ejs
git commit -m "feat: add gallery view for saved derivative images"
```

---

### Task 6: manage.ejs에 "파생 이미지 보기" 버튼 추가

**Files:**
- Modify: `src/web/views/characters/manage.ejs`

- [ ] **Step 1: 캐릭터 목록 API에 ref_images 개수 추가**

`character-routes.ts`의 `GET /` 핸들러를 수정하여 ref_images 카운트도 반환:

```typescript
import {
  findCharacterById,
  listCharacters,
  updateCharacterStatus,
  listRefImagesByChar,
  countRefImagesByChar,
} from '../../db/queries/character-queries';
```

`character-queries.ts`에 카운트 쿼리 추가:

```typescript
export const COUNT_REF_IMAGES_BY_CHAR = `
  SELECT COUNT(*) AS CNT
    FROM char_ref_images
   WHERE char_id = :charId AND approved = 1
`;

export async function countRefImagesByChar(
  conn: oracledb.Connection,
  charId: string,
): Promise<number> {
  const result = await conn.execute<{ CNT: number }>(
    COUNT_REF_IMAGES_BY_CHAR,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return result.rows?.[0]?.CNT ?? 0;
}
```

`character-routes.ts`의 `GET /` 핸들러 수정 — `withJobs` map 안에서 ref image count도 조회:

```typescript
const withJobs = await Promise.all(
  rows.map(async (r) => {
    const latestJobId = await getLatestJobByChar(conn, r.CHAR_ID as string);
    const refImageCount = await countRefImagesByChar(conn, r.CHAR_ID as string);
    return { ...r, LATEST_JOB_ID: latestJobId, REF_IMAGE_COUNT: refImageCount };
  }),
);
```

- [ ] **Step 2: manage.ejs createCard에 갤러리 버튼 추가**

`manage.ejs`의 `createCard` 함수에서 actions div 구성 부분, `if (c.LATEST_JOB_ID)` 블록 뒤에 추가:

```javascript
    if (c.REF_IMAGE_COUNT > 0) {
      var galleryBtn = document.createElement('a');
      galleryBtn.href = '/characters/' + encodeURIComponent(c.CHAR_ID) + '/gallery';
      galleryBtn.className = 'flex-1 bg-green-500/20 hover:bg-green-500/40 text-green-400 text-xs py-2 rounded-lg transition text-center font-semibold';
      galleryBtn.textContent = '파생 이미지 (' + c.REF_IMAGE_COUNT + ')';
      actions.appendChild(galleryBtn);
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/character-queries.ts src/characters/routes/character-routes.ts src/web/views/characters/manage.ejs
git commit -m "feat: add gallery link to character cards in manage page"
```

---

### Task 7: 빌드 확인

- [ ] **Step 1: TypeScript 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없이 종료

- [ ] **Step 2: 수동 테스트 체크리스트**

1. `/characters` 페이지에서 `anchor_set` 캐릭터에 "파생 이미지 (N)" 버튼이 보이는지 확인
2. 버튼 클릭 시 `/characters/:charId/gallery` 페이지로 이동하는지 확인
3. 갤러리에서 이미지 그리드가 정상 렌더링되는지 확인
4. 이미지 클릭 시 모달에 큰 이미지 + 라벨이 표시되는지 확인
5. 재생성 시 스피너 → 새 이미지로 교체되는지 확인
6. 재생성 후 이미지 클릭 시 새 이미지가 정상 표시되는지 확인

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: verify gallery feature build"
```
