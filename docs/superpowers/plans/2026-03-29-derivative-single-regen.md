# Derivative Single-Image Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파생 이미지 결과 그리드에서 특정 이미지를 선택해 수정 프롬프트를 입력하고 해당 이미지만 재생성한다.

**Architecture:** 모달에 수정 프롬프트 입력창과 재생성 버튼 추가 → 버튼 클릭 시 모달 닫고 해당 카드에 스피너 오버레이 표시 → `POST /api/characters/derivatives/:jobId/regenerate` 호출 → 서버에서 기존 파일/DB 삭제 후 새 이미지 생성 → 카드 이미지 교체.

**Tech Stack:** TypeScript, Express, Vitest, Oracle DB (oracledb), ComfyUI (Kontext), EJS

---

## File Map

| 파일 | 변경 내용 |
|------|-----------|
| `src/characters/services/derivative-generator.ts` | `buildRegenPrompt`, `regenerateSingleDerivative` 함수 추가 |
| `src/characters/routes/derivative-routes.ts` | `POST /derivatives/:jobId/regenerate` 엔드포인트 추가 |
| `src/web/views/characters/derivatives.ejs` | 모달 UI 수정 + JS 재생성 흐름 추가 |
| `tests/characters/derivative-regen.test.ts` | 신규 테스트 파일 |

---

## Task 1: `buildRegenPrompt` 순수 함수 + 테스트

**Files:**
- Create: `tests/characters/derivative-regen.test.ts`
- Modify: `src/characters/services/derivative-generator.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// tests/characters/derivative-regen.test.ts
import { describe, it, expect } from 'vitest';
import { buildRegenPrompt } from '../../src/characters/services/derivative-generator';

describe('buildRegenPrompt', () => {
  it('원본 프롬프트와 수정 지시를 조합한다', () => {
    const result = buildRegenPrompt(
      'Change her expression to a gentle warm smile.',
      '눈을 더 크게 만들어줘',
    );
    expect(result).toBe(
      'Change her expression to a gentle warm smile. Additionally: 눈을 더 크게 만들어줘',
    );
  });

  it('수정 지시가 빈 문자열이면 원본 프롬프트만 반환한다', () => {
    const result = buildRegenPrompt('Change her expression to a gentle warm smile.', '');
    expect(result).toBe('Change her expression to a gentle warm smile.');
  });

  it('수정 지시의 앞뒤 공백을 제거한다', () => {
    const result = buildRegenPrompt('Base prompt.', '  trim this  ');
    expect(result).toBe('Base prompt. Additionally: trim this');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run tests/characters/derivative-regen.test.ts
```
Expected: FAIL — "buildRegenPrompt is not exported"

- [ ] **Step 3: `buildRegenPrompt` 함수 구현**

`src/characters/services/derivative-generator.ts`의 공개 API 섹션(`stopDerivativeGeneration` 아래)에 추가:

```typescript
/** 원본 프리셋 프롬프트에 수정 지시를 조합한다. */
export function buildRegenPrompt(basePrompt: string, modifyPrompt: string): string {
  const trimmed = modifyPrompt.trim();
  if (!trimmed) return basePrompt;
  return `${basePrompt} Additionally: ${trimmed}`;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run tests/characters/derivative-regen.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add tests/characters/derivative-regen.test.ts src/characters/services/derivative-generator.ts
git commit -m "feat: add buildRegenPrompt utility for single image regeneration"
```

---

## Task 2: `regenerateSingleDerivative` 서비스 함수

**Files:**
- Modify: `src/characters/services/derivative-generator.ts`

이 함수는 ComfyUI/DB I/O가 포함되어 단위 테스트가 불가하므로 Task 1의 순수 함수만 테스트하고 여기서는 구현만 진행한다.

- [ ] **Step 1: `regenerateSingleDerivative` 함수 추가**

`buildRegenPrompt` 함수 아래에 추가:

```typescript
/**
 * 특정 라벨의 파생 이미지를 재생성한다.
 * 기존 파일과 DB 레코드를 삭제하고 새 이미지로 교체한다.
 */
export async function regenerateSingleDerivative(
  jobId: string,
  label: string,
  modifyPrompt: string,
): Promise<DerivativeResult> {
  const job = activeJobs.get(jobId);
  if (!job) throw new Error(`작업을 찾을 수 없습니다: ${jobId}`);

  const preset = DERIVATIVE_PRESETS.find((p) => p.label === label);
  if (!preset) throw new Error(`프리셋을 찾을 수 없습니다: ${label}`);

  const existingIdx = job.results.findIndex((r) => r.label === label);
  const existing = existingIdx >= 0 ? job.results[existingIdx] : undefined;

  // 기존 파일 삭제
  if (existing) {
    const fs = await import('fs');
    if (fs.existsSync(existing.imagePath)) fs.unlinkSync(existing.imagePath);
    const thumbPath = path.join(
      path.dirname(existing.imagePath),
      `thumb_${path.basename(existing.imagePath)}`,
    );
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    // 기존 DB 레코드 삭제
    if (existing.refId) {
      const conn = await getConnection();
      try {
        await conn.execute(
          'DELETE FROM char_ref_images WHERE ref_id = :refId',
          { refId: existing.refId },
          { autoCommit: true },
        );
      } finally {
        await conn.close();
      }
    }
  }

  // 조합 프롬프트로 새 이미지 생성
  const combinedPreset: DerivativePreset = {
    ...preset,
    promptSuffix: buildRegenPrompt(preset.promptSuffix, modifyPrompt),
  };
  const outDir = path.join(EXPORTS_BASE, job.charId, job.jobId);
  await ensureDir(outDir);

  const newResult = await generateOneImage(job, combinedPreset, '', outDir);
  if (!newResult) throw new Error('이미지 생성 실패');

  if (existingIdx >= 0) {
    job.results[existingIdx] = newResult;
  } else {
    job.results.push(newResult);
  }

  logger.info('단일 파생 이미지 재생성 완료', { jobId, label, modifyPrompt });
  return newResult;
}
```

- [ ] **Step 2: 타입스크립트 컴파일 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/characters/services/derivative-generator.ts
git commit -m "feat: add regenerateSingleDerivative service function"
```

---

## Task 3: 재생성 API 엔드포인트

**Files:**
- Modify: `src/characters/routes/derivative-routes.ts`

- [ ] **Step 1: import에 `regenerateSingleDerivative` 추가**

`derivative-routes.ts` 상단의 import 블록을 수정:

```typescript
import {
  startDerivativeGeneration,
  getDerivativeJob,
  derivativeEvents,
  stopDerivativeGeneration,
  regenerateSingleDerivative,
} from '../services/derivative-generator';
```

- [ ] **Step 2: 엔드포인트 추가**

파일 마지막 `export default router;` 바로 위에 추가:

```typescript
router.post(
  '/derivatives/:jobId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const { label, modifyPrompt } = req.body as {
      label: string;
      modifyPrompt: string;
    };

    if (!label) {
      res.status(400).json({ success: false, error: 'label은 필수입니다' });
      return;
    }

    const result = await regenerateSingleDerivative(jobId, label, modifyPrompt ?? '');
    res.json({ success: true, result });
  }),
);
```

- [ ] **Step 3: 타입스크립트 컴파일 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add src/characters/routes/derivative-routes.ts
git commit -m "feat: add POST /derivatives/:jobId/regenerate endpoint"
```

---

## Task 4: 프론트엔드 UI — 모달 + 재생성 흐름

**Files:**
- Modify: `src/web/views/characters/derivatives.ejs`

### Step 1: 모달 HTML 교체

- [ ] `derivatives.ejs`에서 기존 모달 div 전체(`id="img-modal"` 블록)를 아래로 교체:

```html
<!-- 이미지 모달 -->
<div id="img-modal" class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center hidden">
  <div class="relative max-w-[85vw] max-h-[90vh] flex flex-col items-center">
    <img id="img-modal-src" class="max-w-full max-h-[65vh] rounded-lg shadow-2xl" src="" alt="">
    <p id="img-modal-label" class="text-sm text-[#d2bbff] font-semibold mt-3"></p>
    <p id="img-modal-prompt" class="text-xs text-[#ccc3d8] mt-1 max-w-xl text-center"></p>

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
```

### Step 2: JS — 카드 data-label 및 모달 라벨 추적

- [ ] `createResultCard` 함수 상단 `card.className = ...` 바로 아래 줄에 추가:

```javascript
card.dataset.label = r.label;
```

- [ ] IIFE 스코프 상단(기존 `var isStopping = false;` 선언 바로 아래)에 추가:

```javascript
var currentModalLabel = '';
```

- [ ] 기존 `card.addEventListener('click', ...)` 핸들러 내부를 교체:

```javascript
card.addEventListener('click', function() {
  if (r.imagePath) {
    currentModalLabel = r.label;
    document.getElementById('img-modal-src').src = pathToUrl(r.imagePath);
    document.getElementById('img-modal-label').textContent = r.label;
    document.getElementById('img-modal-prompt').textContent = r.prompt || '';
    document.getElementById('img-modal-modify').value = '';
    document.getElementById('img-modal').classList.remove('hidden');
  }
});
```

### Step 3: JS — 재생성 버튼 핸들러

- [ ] 기존 `modal-close` 이벤트 리스너 아래에 추가 (모달 배경 클릭 핸들러 위):

```javascript
document.getElementById('modal-regen-btn').addEventListener('click', function() {
  var label = currentModalLabel;
  var modifyPrompt = document.getElementById('img-modal-modify').value;
  if (!label) return;

  document.getElementById('img-modal').classList.add('hidden');

  // 해당 카드에 스피너 오버레이
  var card = document.querySelector('[data-label="' + CSS.escape(label) + '"]');
  var overlayId = 'regen-overlay-' + label.replace(/\W/g, '_');
  if (card) {
    var overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'absolute inset-0 bg-black/70 flex items-center justify-center rounded-lg z-10';
    var spinner = document.createElement('span');
    spinner.className = 'animate-spin text-white text-2xl';
    spinner.textContent = '\u25D6';
    overlay.appendChild(spinner);
    card.style.position = 'relative';
    card.appendChild(overlay);
  }

  fetch('/api/characters/derivatives/' + JOB_ID + '/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label, modifyPrompt: modifyPrompt })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var ov = document.getElementById(overlayId);
    if (ov) ov.remove();
    if (data.success && data.result && card) {
      var img = card.querySelector('img');
      if (img) {
        img.src = thumbUrl(data.result.imagePath) + '?t=' + Date.now();
      }
      addLog(label + ' 재생성 완료');
    } else {
      addLog('재생성 실패: ' + (data.error || '알 수 없는 오류'));
    }
  })
  .catch(function(err) {
    var ov = document.getElementById(overlayId);
    if (ov) ov.remove();
    addLog('재생성 실패: ' + err.message);
  });
});
```

- [ ] **Step 4: 타입스크립트 컴파일 확인**

```bash
npx tsc --noEmit
```
Expected: 오류 없음

- [ ] **Step 5: 전체 테스트 실행**

```bash
npx vitest run
```
Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/web/views/characters/derivatives.ejs
git commit -m "feat: add single derivative image regeneration UI"
```

---

## 스펙 커버리지 체크

| 요구사항 | 대응 Task |
|---------|-----------|
| 파생 이미지 선택 (클릭) | Task 4 — 카드 클릭 → 모달 |
| 수정 프롬프트 입력 | Task 4 — 모달 textarea |
| 재생성 확인 버튼 | Task 4 — 재생성 버튼 |
| 해당 이미지만 재생성 | Task 2 — `regenerateSingleDerivative` |
| 기존 이미지 파일 삭제 | Task 2 — `fs.unlinkSync` |
| DB 교체 | Task 2 — DELETE + INSERT |
| 카드 이미지 교체 (새로고침 없이) | Task 4 — `img.src` 교체 |
| 카드 스피너 오버레이 | Task 4 — overlay div (DOM 메서드 사용) |
| 원본 프롬프트 + 수정 지시 조합 | Task 1 — `buildRegenPrompt` |
