# 파생 이미지 다중 선택 승인 기능 설계

**날짜:** 2026-03-30
**상태:** 승인됨

---

## 개요

파생 이미지(`char_ref_images`)에 대한 다중 선택 승인/취소 기능을 두 화면에 추가한다.

- `derivatives.ejs` — 생성 완료 후 결과 카드에서 선택 승인
- `gallery.ejs` — 전체 이미지(미승인 포함) 목록에서 선택 승인/취소

공유 JS 모듈(`approval.js`)로 멀티셀렉트 UX를 재사용하고, API 엔드포인트 하나로 두 화면을 처리한다.

---

## 백엔드

### DB 쿼리 추가 (`character-queries.ts`)

**`LIST_ALL_REF_IMAGES_BY_CHAR`**
```sql
SELECT ref_id, char_id, image_path, pose_tag,
       quality_score, approved, created_at
  FROM char_ref_images
 WHERE char_id = :charId
 ORDER BY created_at ASC
```
- 기존 `LIST_REF_IMAGES_BY_CHAR`의 `AND approved = 1` 조건을 제거한 버전
- 갤러리 리뷰 모드에서 사용

**`listAllRefImagesByChar`** 함수 추가 (기존 `listRefImagesByChar` 유지)

**`batchApproveRefImages`** 함수 추가
```typescript
// oracledb executeMany 사용
await conn.executeMany(
  'UPDATE char_ref_images SET approved = :approved WHERE ref_id = :refId',
  refIds.map(id => ({ refId: id, approved: approvedVal })),
  { autoCommit: true }
);
```

### API 엔드포인트 (`gallery-routes.ts`)

```
PATCH /api/characters/:charId/ref-images/approve-batch
```

**Request body:**
```json
{ "refIds": [1, 2, 3], "approved": true }
```

**Response:**
```json
{ "success": true, "updated": 3 }
```

- `approved: true` → 승인, `approved: false` → 승인 취소
- `refIds`가 비어있거나 잘못된 형식이면 400 반환
- 보안: `charId` 소유 여부는 현재 검증하지 않음 (내부 툴이므로 생략)

---

## 공유 JS 모듈 (`public/js/approval.js`)

```javascript
initApprovalMode(gridEl, { charId, onApproved })
```

**동작:**
1. `gridEl` 내 `[data-ref-id]` 속성을 가진 카드마다 체크박스 오버레이 삽입
2. 카드 클릭 → 선택/해제 토글 (선택 모드 중에는 기존 클릭 이벤트 억제)
3. 선택 개수 > 0 이면 하단 플로팅 바 노출:
   ```
   N장 선택됨   [승인]   [승인 취소]   [선택 해제]
   ```
4. [승인] / [승인 취소] 클릭 → `PATCH .../approve-batch` 호출 → `onApproved(refIds, approved)` 콜백
5. 모드 종료 시 체크박스 오버레이 제거, 플로팅 바 숨김

**내보내는 인터페이스:**
```javascript
window.ApprovalMode = {
  init(gridEl, options),   // 모드 시작
  destroy(),               // 모드 종료
};
```

---

## 화면별 변경

### `derivatives.ejs`

1. `createResultCard`에 `card.dataset.refId = String(r.refId ?? '')` 추가
2. 생성 완료(`status === 'completed'`) 시 기존 갤러리/LoRA 버튼 옆에 "선택 승인" 버튼 추가
3. "선택 승인" 클릭 → `ApprovalMode.init(grid, { charId, onApproved })` 호출
4. `onApproved` 콜백: 승인된 카드에 초록 테두리 표시, 토스트 알림

### `gallery.ejs`

1. `loadGallery`에서 `/ref-images` API를 그대로 사용하되, 백엔드에서 전체 조회로 교체
2. `createCard`에 승인 상태 시각화 추가:
   - 미승인: 카드 테두리 회색 + 우상단 "미승인" 배지
   - 승인됨: 카드 테두리 초록 + 우상단 "✓" 배지
3. 상단에 "선택 승인" 토글 버튼 추가
4. 토글 ON → `ApprovalMode.init(grid, { charId, onApproved })` 호출
5. 토글 OFF → `ApprovalMode.destroy()` 호출
6. `onApproved` 콜백: 해당 카드의 승인 배지 업데이트 (페이지 새로고침 없이)

---

## 파일 변경 목록

| 파일 | 변경 유형 |
|------|----------|
| `src/db/queries/character-queries.ts` | 쿼리 + 함수 추가 |
| `src/characters/routes/gallery-routes.ts` | PATCH 엔드포인트 추가, GET 쿼리 교체 |
| `src/web/public/js/approval.js` | 신규 생성 |
| `src/web/views/characters/derivatives.ejs` | data-ref-id 추가, 선택 승인 버튼 추가 |
| `src/web/views/characters/gallery.ejs` | 전체 이미지 표시, 승인 UI 추가 |

---

## 미결 사항

없음.
