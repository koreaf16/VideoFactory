# 파생 이미지 다중 선택 승인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파생 이미지를 여러 장 선택해서 한 번에 승인/취소할 수 있는 기능을 `derivatives.ejs`와 `gallery.ejs` 두 화면에 추가한다.

**Architecture:** 공유 JS 모듈(`approval.js`)이 멀티셀렉트 UX와 API 호출을 담당하고, 두 화면이 각자 `ApprovalMode.init/destroy`를 호출해 재사용한다. 백엔드는 `PATCH .../approve-batch` 엔드포인트 하나로 승인·취소를 모두 처리한다.

**Tech Stack:** TypeScript, Express, oracledb (executeMany), Vanilla JS, EJS, Vitest

---

## 파일 변경 목록

| 파일 | 유형 |
|------|------|
| `src/db/queries/character-queries.ts` | 수정 — 쿼리 상수 2개 + 함수 2개 추가 |
| `src/characters/routes/gallery-routes.ts` | 수정 — GET 쿼리 교체 + PATCH 엔드포인트 추가, 검증 함수 export |
| `tests/characters/approve-batch.test.ts` | 신규 — parseApproveBatchBody 유닛 테스트 |
| `src/web/public/js/approval.js` | 신규 — 공유 멀티셀렉트 승인 모듈 |
| `src/web/views/characters/derivatives.ejs` | 수정 — data-ref-id 추가, 승인 버튼 추가, approval.js 로드 |
| `src/web/views/characters/gallery.ejs` | 수정 — 전체 이미지 표시, 승인 배지, 선택 승인 UI |

---

## Task 1: DB 쿼리 추가

**Files:**
- Modify: `src/db/queries/character-queries.ts`

- [ ] **Step 1: `LIST_ALL_REF_IMAGES_BY_CHAR` 쿼리 상수 추가**

`LIST_REF_IMAGES_BY_CHAR` 상수 바로 아래에 다음을 추가한다:

```typescript
export const LIST_ALL_REF_IMAGES_BY_CHAR = `
  SELECT ref_id, char_id, image_path, pose_tag,
         quality_score, approved, created_at
    FROM char_ref_images
   WHERE char_id = :charId
   ORDER BY created_at ASC
`;
```

- [ ] **Step 2: `listAllRefImagesByChar` 함수 추가**

`listRefImagesByChar` 함수 바로 아래에 추가한다:

```typescript
export async function listAllRefImagesByChar(
  conn: oracledb.Connection,
  charId: string,
): Promise<RefImageRow[]> {
  const result = await conn.execute<RefImageRow>(
    LIST_ALL_REF_IMAGES_BY_CHAR,
    { charId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  logger.debug('파생 이미지 전체 목록 조회', { charId, count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}
```

- [ ] **Step 3: `batchApproveRefImages` 함수 추가**

`listAllRefImagesByChar` 바로 아래에 추가한다:

```typescript
export async function batchApproveRefImages(
  conn: oracledb.Connection,
  refIds: number[],
  approved: boolean,
): Promise<number> {
  if (refIds.length === 0) return 0;
  const approvedNum = approved ? 1 : 0;
  const result = await conn.executeMany(
    'UPDATE char_ref_images SET approved = :approved WHERE ref_id = :refId',
    refIds.map((id) => ({ refId: id, approved: approvedNum })),
    { autoCommit: true },
  );
  const updated = result.rowsAffected ?? 0;
  logger.info('파생 이미지 일괄 승인 업데이트', { count: refIds.length, approved, updated });
  return updated;
}
```

- [ ] **Step 4: 빌드 확인**

```bash
cd C:/VideoFactory && npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/db/queries/character-queries.ts
git commit -m "feat: add listAllRefImages and batchApproveRefImages queries"
```

---

## Task 2: API 엔드포인트 추가

**Files:**
- Modify: `src/characters/routes/gallery-routes.ts`
- Create: `tests/characters/approve-batch.test.ts`

- [ ] **Step 1: 테스트 작성**

`tests/characters/approve-batch.test.ts` 파일을 생성한다:

```typescript
import { describe, it, expect } from 'vitest';
import { parseApproveBatchBody } from '../../src/characters/routes/gallery-routes';

describe('parseApproveBatchBody', () => {
  it('refIds가 없으면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ approved: true })).toBeNull();
  });

  it('refIds가 빈 배열이면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [], approved: true })).toBeNull();
  });

  it('approved가 boolean이 아니면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [1, 2], approved: 1 })).toBeNull();
  });

  it('approved가 없으면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [1] })).toBeNull();
  });

  it('유효한 입력이면 파싱된 객체를 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [1, 2, 3], approved: false })).toEqual({
      refIds: [1, 2, 3],
      approved: false,
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd C:/VideoFactory && npx vitest run tests/characters/approve-batch.test.ts
```

Expected: FAIL — `parseApproveBatchBody` not exported

- [ ] **Step 3: `gallery-routes.ts` 업데이트**

파일 전체를 다음으로 교체한다:

```typescript
/**
 * @module 파생 이미지 갤러리 API 라우터
 * @description 캐릭터 파생 이미지 조회/승인 API.
 *
 * @dependencies express, db queries
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  listAllRefImagesByChar,
  batchApproveRefImages,
} from '../../db/queries/character-queries';

const router = Router();

// ─── 입력 검증 (테스트 가능하도록 export) ──────────────────────

export function parseApproveBatchBody(
  body: unknown,
): { refIds: number[]; approved: boolean } | null {
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.refIds) || b.refIds.length === 0) return null;
  if (typeof b.approved !== 'boolean') return null;
  return { refIds: b.refIds as number[], approved: b.approved };
}

// ─── 파생 이미지 갤러리 ───────────────────────────────────────

router.get(
  '/:charId/ref-images',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const conn = await getConnection();
    try {
      const rows = await listAllRefImagesByChar(conn, charId);
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

// ─── 일괄 승인/취소 ───────────────────────────────────────────

router.patch(
  '/:charId/ref-images/approve-batch',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const parsed = parseApproveBatchBody(req.body);

    if (!parsed) {
      res.status(400).json({
        success: false,
        error: 'refIds(비어있지 않은 배열)와 approved(boolean)가 필요합니다',
      });
      return;
    }

    const conn = await getConnection();
    try {
      const updated = await batchApproveRefImages(conn, parsed.refIds, parsed.approved);
      res.json({ success: true, updated, charId });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd C:/VideoFactory && npx vitest run tests/characters/approve-batch.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/characters/routes/gallery-routes.ts tests/characters/approve-batch.test.ts
git commit -m "feat: add approve-batch endpoint and parseApproveBatchBody"
```

---

## Task 3: 공유 approval.js 모듈

**Files:**
- Create: `src/web/public/js/approval.js`

- [ ] **Step 1: 파일 생성**

`src/web/public/js/approval.js`를 생성한다:

```javascript
/**
 * @module ApprovalMode
 * @description 파생 이미지 다중 선택 승인 모듈.
 *
 * 사용법:
 *   ApprovalMode.init(gridEl, { charId: 'soyul', onApproved: fn });
 *   ApprovalMode.destroy();
 */
(function (global) {
  var _grid = null;
  var _options = null;
  var _selected = new Set();
  var _floatingBar = null;
  var _observer = null;

  // ── 카드 체크박스 추가 ──────────────────────────────────────

  function addCheckbox(card) {
    if (!card.dataset.refId || card.dataset.refId === '' || card.querySelector('.approval-cb-wrap')) return;

    var wrap = document.createElement('div');
    wrap.className = 'approval-cb-wrap';
    wrap.style.cssText = 'position:absolute;top:6px;left:6px;z-index:10;pointer-events:auto;';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:#7c3aed;';

    cb.addEventListener('change', function (e) {
      e.stopPropagation();
      toggleSelect(card, cb.checked);
    });

    wrap.appendChild(cb);
    card.style.position = 'relative';
    card.insertBefore(wrap, card.firstChild);
  }

  // ── 그리드 클릭 인터셉터 (capture phase) ────────────────────

  function onGridClick(e) {
    var card = e.target.closest('[data-ref-id]');
    if (!card) return;
    if (e.target.closest('.approval-cb-wrap')) return; // 체크박스 클릭은 허용

    e.stopImmediatePropagation();
    e.preventDefault();

    var cb = card.querySelector('.approval-cb-wrap input');
    if (cb) {
      cb.checked = !cb.checked;
      toggleSelect(card, cb.checked);
    }
  }

  // ── 선택 토글 ───────────────────────────────────────────────

  function toggleSelect(card, selected) {
    var refId = Number(card.dataset.refId);
    if (!refId) return;

    if (selected) {
      _selected.add(refId);
      card.style.outline = '2px solid #7c3aed';
      card.style.outlineOffset = '-2px';
    } else {
      _selected.delete(refId);
      card.style.outline = '';
    }
    updateFloatingBar();
  }

  // ── 플로팅 액션 바 ──────────────────────────────────────────

  function createFloatingBar() {
    var bar = document.createElement('div');
    bar.id = 'approval-floating-bar';
    bar.style.cssText =
      'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
      'background:#1b1b1d;border:1px solid #353437;border-radius:12px;' +
      'padding:12px 20px;display:none;align-items:center;gap:12px;' +
      'z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:nowrap;';

    var countEl = document.createElement('span');
    countEl.id = 'approval-bar-count';
    countEl.style.cssText = 'color:#ccc3d8;font-size:14px;';
    countEl.textContent = '0장 선택됨';

    function makeBtn(label, bg, fg) {
      var btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText =
        'background:' + bg + ';color:' + fg + ';border:none;border-radius:8px;' +
        'padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;';
      return btn;
    }

    var approveBtn = makeBtn('승인', '#7c3aed', '#fff');
    var unapproveBtn = makeBtn('승인 취소', '#353437', '#e5e1e4');
    var clearBtn = makeBtn('선택 해제', 'transparent', '#ccc3d8');
    clearBtn.style.fontWeight = '400';

    approveBtn.addEventListener('click', function () { submitApproval(true); });
    unapproveBtn.addEventListener('click', function () { submitApproval(false); });
    clearBtn.addEventListener('click', clearSelection);

    bar.appendChild(countEl);
    bar.appendChild(approveBtn);
    bar.appendChild(unapproveBtn);
    bar.appendChild(clearBtn);
    return bar;
  }

  function updateFloatingBar() {
    if (!_floatingBar) return;
    var count = _selected.size;
    document.getElementById('approval-bar-count').textContent = count + '장 선택됨';
    _floatingBar.style.display = count > 0 ? 'flex' : 'none';
  }

  function clearSelection() {
    _selected.clear();
    if (_grid) {
      _grid.querySelectorAll('[data-ref-id]').forEach(function (card) {
        card.style.outline = '';
        var cb = card.querySelector('.approval-cb-wrap input');
        if (cb) cb.checked = false;
      });
    }
    updateFloatingBar();
  }

  // ── API 호출 ────────────────────────────────────────────────

  function submitApproval(approved) {
    var refIds = Array.from(_selected);
    if (refIds.length === 0) return;

    fetch('/api/characters/' + encodeURIComponent(_options.charId) + '/ref-images/approve-batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refIds: refIds, approved: approved }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (typeof showToast === 'function') {
            showToast((approved ? '승인' : '승인 취소') + ' 완료: ' + data.updated + '장', 'success');
          }
          if (_options.onApproved) _options.onApproved(Array.from(_selected), approved);
          clearSelection();
        } else {
          if (typeof showToast === 'function') showToast('승인 실패: ' + (data.error || '오류'), 'error');
        }
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('승인 실패: ' + err.message, 'error');
      });
  }

  // ── 공개 API ────────────────────────────────────────────────

  function init(gridEl, options) {
    if (_grid) destroy(); // 재진입 방지

    _grid = gridEl;
    _options = options;
    _selected = new Set();

    _floatingBar = createFloatingBar();
    document.body.appendChild(_floatingBar);

    // 현재 카드에 체크박스 추가
    gridEl.querySelectorAll('[data-ref-id]').forEach(addCheckbox);

    // 이후 추가되는 카드도 처리 (derivatives 뷰 SSE 중)
    _observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) {
            if (node.dataset && node.dataset.refId) addCheckbox(node);
            node.querySelectorAll && node.querySelectorAll('[data-ref-id]').forEach(addCheckbox);
          }
        });
      });
    });
    _observer.observe(gridEl, { childList: true, subtree: true });

    // 카드 클릭 인터셉트 (모달 방지)
    gridEl.addEventListener('click', onGridClick, true);
  }

  function destroy() {
    if (_grid) {
      _grid.removeEventListener('click', onGridClick, true);
      _grid.querySelectorAll('.approval-cb-wrap').forEach(function (el) { el.remove(); });
      _grid.querySelectorAll('[data-ref-id]').forEach(function (card) {
        card.style.outline = '';
      });
    }
    if (_observer) { _observer.disconnect(); _observer = null; }
    if (_floatingBar) { _floatingBar.remove(); _floatingBar = null; }
    _selected.clear();
    _grid = null;
    _options = null;
  }

  global.ApprovalMode = { init: init, destroy: destroy };
})(window);
```

- [ ] **Step 2: 커밋**

```bash
git add src/web/public/js/approval.js
git commit -m "feat: add shared ApprovalMode JS module"
```

---

## Task 4: derivatives.ejs 업데이트

**Files:**
- Modify: `src/web/views/characters/derivatives.ejs`

- [ ] **Step 1: `createResultCard`에 `data-ref-id` 추가**

`createResultCard` 함수에서 `card.dataset.label` 바로 아래 줄을 추가한다:

변경 전:
```javascript
    card.className = 'w-[150px] flex-shrink-0 bg-[#2a2a2c] rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#7c3aed] transition';
    card.dataset.label = r.label;
    card.dataset.imagePath = r.imagePath || '';
    card.dataset.prompt = r.prompt || '';
```

변경 후:
```javascript
    card.className = 'w-[150px] flex-shrink-0 bg-[#2a2a2c] rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#7c3aed] transition';
    card.dataset.label = r.label;
    card.dataset.refId = String(r.refId ?? '');
    card.dataset.imagePath = r.imagePath || '';
    card.dataset.prompt = r.prompt || '';
```

- [ ] **Step 2: 생성 완료 시 "선택 승인" 버튼 추가**

`data.status === 'completed'` 블록 안의 galleryBtn/loraBtn 표시 부분을 찾아서 "선택 승인" 버튼을 추가한다.

변경 전:
```javascript
      if (data.charId) {
        var galleryBtn = document.getElementById('btn-gallery');
        galleryBtn.href = '/characters/' + encodeURIComponent(data.charId) + '/gallery';
        galleryBtn.classList.remove('hidden');
        document.getElementById('btn-lora').classList.remove('hidden');
      }
```

변경 후:
```javascript
      if (data.charId) {
        var galleryBtn = document.getElementById('btn-gallery');
        galleryBtn.href = '/characters/' + encodeURIComponent(data.charId) + '/gallery';
        galleryBtn.classList.remove('hidden');
        document.getElementById('btn-lora').classList.remove('hidden');
        document.getElementById('btn-approve').classList.remove('hidden');
        document.getElementById('btn-approve').dataset.charId = data.charId;
      }
```

- [ ] **Step 3: 액션 버튼 영역에 "선택 승인" 버튼 HTML 추가**

액션 버튼 `<div id="action-buttons"...>` 안에 버튼을 추가한다.

변경 전:
```html
      <a id="btn-gallery" href="#" class="bg-green-500/20 hover:bg-green-500/40 text-green-400 text-sm font-semibold px-4 py-2 rounded-lg transition hidden">갤러리 보기</a>
      <a id="btn-lora" href="/characters/lora-dataset" class="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-semibold px-4 py-2 rounded-lg transition hidden">LoRA 학습 시작</a>
```

변경 후:
```html
      <a id="btn-gallery" href="#" class="bg-green-500/20 hover:bg-green-500/40 text-green-400 text-sm font-semibold px-4 py-2 rounded-lg transition hidden">갤러리 보기</a>
      <a id="btn-lora" href="/characters/lora-dataset" class="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-semibold px-4 py-2 rounded-lg transition hidden">LoRA 학습 시작</a>
      <button id="btn-approve" data-char-id="" class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition hidden">선택 승인</button>
```

- [ ] **Step 4: "선택 승인" 버튼 클릭 이벤트 + approval.js 로드**

`evtSource.onerror` 리스너 이후, `</script>` 닫기 직전에 다음 코드를 추가한다:

```javascript
  // 선택 승인 버튼 토글
  var approveActive = false;
  document.getElementById('btn-approve').addEventListener('click', function() {
    var grid = document.getElementById('result-grid');
    var charId = this.dataset.charId;
    if (!approveActive) {
      approveActive = true;
      this.textContent = '선택 종료';
      this.className = this.className.replace('bg-green-600 hover:bg-green-700', 'bg-gray-600 hover:bg-gray-700');
      ApprovalMode.init(grid, {
        charId: charId,
        onApproved: function(refIds, approved) {
          addLog((approved ? '승인' : '승인 취소') + ' 완료: ' + refIds.length + '장');
        },
      });
    } else {
      approveActive = false;
      this.textContent = '선택 승인';
      this.className = this.className.replace('bg-gray-600 hover:bg-gray-700', 'bg-green-600 hover:bg-green-700');
      ApprovalMode.destroy();
    }
  });
```

그리고 파일 맨 아래 `<script src="/js/characters.js"></script>` 아래에 approval.js 로드 태그를 추가한다:

변경 전:
```html
<script src="/js/characters.js"></script>
<script>
```

변경 후:
```html
<script src="/js/characters.js"></script>
<script src="/js/approval.js"></script>
<script>
```

- [ ] **Step 5: 커밋**

```bash
git add src/web/views/characters/derivatives.ejs
git commit -m "feat: add refId to derivative cards and approval toggle button"
```

---

## Task 5: gallery.ejs 업데이트

**Files:**
- Modify: `src/web/views/characters/gallery.ejs`

- [ ] **Step 1: approval.js 로드 및 "선택 승인" 버튼 HTML 추가**

파일 상단 헤더 영역의 "목록으로" 링크 앞에 버튼을 추가한다:

변경 전:
```html
    <a href="/characters" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-4 py-2 rounded-lg transition">목록으로</a>
```

변경 후:
```html
    <div class="flex gap-2 items-center">
      <button id="btn-approve-toggle" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-4 py-2 rounded-lg transition hidden">선택 승인</button>
      <a href="/characters" class="bg-[#353437] hover:bg-[#4a4455] text-[#e5e1e4] text-sm px-4 py-2 rounded-lg transition">목록으로</a>
    </div>
```

그리고 `<script src="/js/characters.js"></script>` 아래에 approval.js를 추가한다:

변경 전:
```html
<script src="/js/characters.js"></script>
<script>
```

변경 후:
```html
<script src="/js/characters.js"></script>
<script src="/js/approval.js"></script>
<script>
```

- [ ] **Step 2: `createCard` 함수에 승인 배지 추가**

`createCard` 함수를 다음으로 교체한다:

```javascript
  function createCard(img) {
    var card = document.createElement('div');
    card.className = 'bg-[#2a2a2c] rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-[#7c3aed] transition relative';
    card.dataset.refId = String(img.refId);
    card.dataset.imagePath = img.imagePath || '';
    card.dataset.approved = img.approved ? '1' : '0';

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

    // 승인 상태 배지
    var badge = document.createElement('div');
    badge.className = 'approval-badge absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded';
    updateBadge(badge, img.approved);
    card.appendChild(badge);

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

  function updateBadge(badge, approved) {
    if (approved) {
      badge.textContent = '✓';
      badge.style.cssText = 'background:rgba(74,222,128,0.2);color:#4ade80;';
    } else {
      badge.textContent = '미승인';
      badge.style.cssText = 'background:rgba(100,100,100,0.4);color:#aaa;';
    }
  }
```

- [ ] **Step 3: `loadGallery`에서 "선택 승인" 버튼 노출 및 `onApproved` 콜백 연결**

`loadGallery` 함수 내 이미지 렌더링 완료 후 버튼 노출 코드를 추가한다.

변경 전:
```javascript
      document.getElementById('stat-count').textContent = images.length;
      document.getElementById('stats-bar').classList.remove('hidden');
      document.getElementById('bottom-actions').classList.remove('hidden');

      var grid = document.getElementById('gallery-grid');
      grid.classList.remove('hidden');
      grid.textContent = '';
      images.forEach(function(img) { grid.appendChild(createCard(img)); });
```

변경 후:
```javascript
      document.getElementById('stat-count').textContent = images.length;
      document.getElementById('stats-bar').classList.remove('hidden');
      document.getElementById('bottom-actions').classList.remove('hidden');
      document.getElementById('btn-approve-toggle').classList.remove('hidden');

      var grid = document.getElementById('gallery-grid');
      grid.classList.remove('hidden');
      grid.textContent = '';
      images.forEach(function(img) { grid.appendChild(createCard(img)); });
```

- [ ] **Step 4: "선택 승인" 토글 버튼 이벤트 + onApproved 콜백 추가**

`loadGallery()` 호출 바로 위, `})();` 닫기 직전에 다음을 추가한다:

```javascript
  // 선택 승인 토글
  var approveActive = false;
  document.getElementById('btn-approve-toggle').addEventListener('click', function() {
    var grid = document.getElementById('gallery-grid');
    if (!approveActive) {
      approveActive = true;
      this.textContent = '선택 종료';
      this.className = this.className.replace('bg-[#353437] hover:bg-[#4a4455]', 'bg-[#7c3aed] hover:bg-[#6d28d9]');
      ApprovalMode.init(grid, {
        charId: CHAR_ID,
        onApproved: function(refIds, approved) {
          // 승인된 카드의 배지 업데이트
          refIds.forEach(function(refId) {
            var card = grid.querySelector('[data-ref-id="' + refId + '"]');
            if (!card) return;
            card.dataset.approved = approved ? '1' : '0';
            var badge = card.querySelector('.approval-badge');
            if (badge) updateBadge(badge, approved);
          });
        },
      });
    } else {
      approveActive = false;
      this.textContent = '선택 승인';
      this.className = this.className.replace('bg-[#7c3aed] hover:bg-[#6d28d9]', 'bg-[#353437] hover:bg-[#4a4455]');
      ApprovalMode.destroy();
    }
  });
```

- [ ] **Step 5: 커밋**

```bash
git add src/web/views/characters/gallery.ejs
git commit -m "feat: add multi-select approval UI to gallery view"
```

---

## Task 6: 전체 테스트 실행 및 최종 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
cd C:/VideoFactory && npx vitest run
```

Expected: 기존 테스트 포함 전체 PASS

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 3: 수동 검증 체크리스트**

1. `GET /api/characters/:charId/ref-images` → `approved: false`인 이미지도 응답에 포함
2. `PATCH /api/characters/:charId/ref-images/approve-batch` → `{ refIds: [1,2], approved: true }` 요청 시 200 + `{ success: true, updated: 2 }` 응답
3. `PATCH` 요청에 `refIds: []` 보내면 400 응답
4. `derivatives.ejs`: 생성 완료 후 "선택 승인" 버튼 노출 → 클릭 시 체크박스 오버레이 활성화 → 카드 선택 → 하단 플로팅 바 표시 → 승인 클릭 → 토스트 표시
5. `gallery.ejs`: 미승인 이미지에 "미승인" 배지 표시 → "선택 승인" 클릭 → 체크박스 활성화 → 승인 후 배지가 "✓"로 변경

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: complete derivative multi-select approval feature"
```
