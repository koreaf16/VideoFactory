# 통합 앵커 이미지 시스템 설계

**Date:** 2026-03-30
**Status:** Draft
**Replaces:** candidate-based system (candidate-generator, candidate-processor, candidate-routes)

## 목표

"캐릭터 후보", "장소 후보" 개념을 제거하고, **앵커 이미지**라는 단일 통합 개념으로 재설계.
- 캐릭터/장소 생성 시 얼굴 일관성/공간 일관성을 위한 앵커 이미지 선택용으로만 사용
- 캐릭터와 장소가 동일한 생성/관리 인터페이스 사용
- 향후 NPC, 아이템 등 다른 엔티티도 쉽게 확장 가능

## 핵심 설계 원칙

1. **폴리모르픽 스토리지** — `anchor_images` 테이블에 `entity_type` + `entity_id`로 캐릭터/장소/NPC 구분
2. **공통 생성 로직** — `src/common/services/anchor-image-generator.ts`에서 모든 엔티티 타입 처리
3. **도메인별 Wrapper** — 캐릭터/장소는 자신의 라우트/서비스에서 공통 모듈만 호출
4. **단일 진입점** — `/api/anchors/*` (엔티티 타입 자동 식별)

## DB 스키마

### 신규 테이블: anchor_images

```sql
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
  face_embedding  VECTOR(384) VECTOR DISTANCE COSINE,

  -- 타임스탐프
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- 제약
  UNIQUE (entity_type, entity_id),
  CONSTRAINT fk_anchor_char
    FOREIGN KEY (entity_id) REFERENCES characters(char_id)
    WHEN entity_type = 'character',
  CONSTRAINT fk_anchor_loc
    FOREIGN KEY (entity_id) REFERENCES locations(location_id)
    WHEN entity_type = 'location'
);

CREATE INDEX idx_anchor_entity ON anchor_images(entity_type, entity_id);
CREATE INDEX idx_anchor_job ON anchor_images(job_id);
```

### 기존 테이블 변경

#### characters (수정)
```sql
ALTER TABLE characters RENAME COLUMN anchor_blob TO anchor_id;
-- anchor_id: NUMBER REFERENCES anchor_images(anchor_id)
-- NULL 허용 (아직 앵커 미설정)

ALTER TABLE characters DROP COLUMN (
  anchor_thumbnail,
  face_embedding
  -- 이제 anchor_images 테이블에서 조회
);
```

#### locations (수정)
```sql
ALTER TABLE locations ADD (
  anchor_id NUMBER REFERENCES anchor_images(anchor_id)
);
-- NULL 허용
```

#### 제거할 테이블
- `char_candidates` — 완전 삭제
- `location_candidates` — 완전 삭제

## 서비스 아키텍처

### 파일 구조

```
src/
  common/
    services/
      ├── anchor-image-generator.ts    ← 공통 모듈 (모든 엔티티 타입)
      └── anchor-image-processor.ts    ← 개별 처리 (ComfyUI, 품질평가, DB저장)

  characters/
    services/
      └── character-anchor.ts          ← 캐릭터 특화 (간단한 wrapper)
    routes/
      └── character-anchor-routes.ts   ← 캐릭터 라우트

  locations/
    services/
      └── location-anchor.ts           ← 장소 특화 (간단한 wrapper)
    routes/
      └── location-anchor-routes.ts    ← 장소 라우트

  db/
    queries/
      └── anchor-image-queries.ts      ← 통합 쿼리 (모든 타입)
```

### 공통 모듈: anchor-image-generator.ts

```typescript
// 엔티티 타입 정의
export type AnchorEntityType = 'character' | 'location' | 'npc';

export interface AnchorGenerationRequest {
  entityType: AnchorEntityType;
  entityId: string;
  count: number;           // 생성할 앵커 이미지 개수
  customPrompt?: string;
  pulidOpts?: PulidModeOptions;
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

// 공개 API
export async function startAnchorGeneration(
  req: AnchorGenerationRequest
): Promise<string>;  // jobId 반환

export function getJob(jobId: string): AnchorGenerationJob | undefined;

export function getJobAnchors(jobId: string): AnchorResult[];

export function stopAnchorGeneration(jobId: string): boolean;
```

### 도메인별 Wrapper

#### character-anchor.ts
```typescript
import { startAnchorGeneration } from '../../common/services/anchor-image-generator';

export async function startCharacterAnchorGeneration(
  charId: string,
  count: number,
  customPrompt?: string
): Promise<string> {
  return startAnchorGeneration({
    entityType: 'character',
    entityId: charId,
    count,
    customPrompt
  });
}

export async function setCharacterAnchor(
  charId: string,
  anchorId: number
): Promise<void> {
  // 캐릭터 테이블의 anchor_id 설정
  // + 얼굴 임베딩 동기화
}
```

#### location-anchor.ts
```typescript
// 유사하게 장소 특화 로직 (간단)
```

## REST API

### 엔드포인트

#### 1. 앵커 이미지 생성 시작

```
POST /api/anchors/generate
Content-Type: application/json

{
  "entityType": "character",        // "character" | "location" | "npc"
  "entityId": "soyul",
  "count": 5,
  "customPrompt": "한국 여고생, 밝은 표정"
}

200 OK
{
  "jobId": "anch_20260330_abc123"
}
```

#### 2. 생성 진행 상황 스트림 (SSE)

```
GET /api/anchors/:jobId/stream
Accept: text/event-stream

event: anchor-progress
data: {
  "completed": 2,
  "total": 5,
  "anchors": [
    {
      "anchorId": 101,
      "imageUrl": "/api/images/anchors/101",
      "thumbnailUrl": "/api/images/anchors/101?thumbnail=true",
      "qualityScore": 0.85,
      "grade": "A"
    }
  ]
}
```

#### 3. 앵커 이미지 조회

```
GET /api/anchors/:anchorId
200 OK
{
  "anchorId": 101,
  "entityType": "character",
  "entityId": "soyul",
  "imageUrl": "/api/images/anchors/101",
  "qualityScore": 0.85,
  "grade": "A",
  "createdAt": "2026-03-30T10:00:00Z"
}
```

#### 4. 앵커 이미지 설정 (캐릭터/장소에 지정)

```
POST /api/characters/:charId/anchor/:anchorId
200 OK
{
  "charId": "soyul",
  "anchorId": 101
}

POST /api/locations/:locationId/anchor/:anchorId
200 OK
{
  "locationId": "soyul_room",
  "anchorId": 102
}
```

#### 5. 생성 중단

```
POST /api/anchors/:jobId/stop
200 OK
{
  "jobId": "anch_20260330_abc123",
  "status": "stopped"
}
```

## 데이터 흐름

### 캐릭터 앵커 이미지 생성 & 설정

```
사용자 (웹 UI)
  │
  ├─ 1. POST /api/characters/soyul/anchors/generate
  │      { count: 5, customPrompt: "..." }
  │      → startCharacterAnchorGeneration()
  │
  └─ 2. GET /api/anchors/{jobId}/stream  (SSE)
       ← 생성 진행 상황 실시간 스트리밍
       ← 앵커 이미지 리스트 표시

  ├─ 3. POST /api/characters/soyul/anchor/{anchorId}
       ← setCharacterAnchor()
       ← characters 테이블의 anchor_id 설정
       ← 얼굴 임베딩 동기화

DB
  ├─ anchor_images (생성된 이미지 + 메타)
  └─ characters (anchor_id FK 업데이트)
```

### 장소 앵커 이미지 생성 & 설정

```
동일한 흐름, entityType만 "location"으로 변경
```

## 마이그레이션 전략 (리셋)

### Step 1: 구 테이블 삭제
- `char_candidates` 테이블 삭제
- `location_candidates` 테이블 삭제

### Step 2: 신규 테이블 생성
- `anchor_images` 테이블 생성
- 인덱스 생성

### Step 3: 기존 테이블 컬럼 변경
- characters: anchor_blob, anchor_thumbnail, face_embedding 삭제 → anchor_id 추가
- locations: location_candidates FK 제거 → anchor_id 추가

## 코드 정리 (삭제할 것)

```
삭제:
  - src/characters/services/candidate-generator.ts
  - src/characters/services/candidate-processor.ts
  - src/characters/routes/candidate-routes.ts

  - src/locations/services/location-candidate-generator.ts
  - src/locations/routes/location-candidate-routes.ts

  - src/db/queries/candidate-queries.ts
  - src/db/queries/location-candidate-queries.ts

  - src/web/views/characters/candidates.ejs
  - src/web/views/locations/candidates.ejs

생성:
  - src/common/services/anchor-image-generator.ts
  - src/common/services/anchor-image-processor.ts

  - src/characters/services/character-anchor.ts
  - src/characters/routes/character-anchor-routes.ts

  - src/locations/services/location-anchor.ts
  - src/locations/routes/location-anchor-routes.ts

  - src/db/queries/anchor-image-queries.ts
```

## 향후 확장성

이 설계로 다음이 쉬워집니다:

- **NPC 앵커**: entityType='npc' 추가만으로 즉시 지원
- **아이템/무기**: entityType='item' 추가
- **생성 이력**: job_id 필드로 여러 세션의 이미지 구분 가능
- **벡터 검색**: face_embedding으로 유사한 캐릭터 찾기 (추후)

## 테스트 전략

1. **앵커 생성**: 캐릭터/장소별 생성 테스트
2. **앵커 설정**: FK 무결성, 임베딩 동기화 확인
3. **다중 엔티티**: 동일 jobId로 여러 타입 생성
4. **폴백**: 레거시 후보 데이터 마이그레이션 검증
