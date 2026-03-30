# Script Registration System Design

**Date:** 2026-03-30
**Status:** Draft

## Overview

Claude CLI(Opus 4.6 max)로 생성한 대본을 VideoFactory에 등록하는 시스템. 캐릭터/장소를 개별 등록한 뒤 에피소드+씬을 일괄 등록하는 순차 호출 방식.

## Workflow

```
Claude CLI (Opus 4.6 max)
  │
  ├─ Step 1: POST /api/characters/   (캐릭터 개별 등록, 반복)
  ├─ Step 2: POST /api/locations/     (장소 개별 등록, 반복)
  └─ Step 3: POST /api/episodes/      (에피소드+씬 일괄 등록)
        │
        ▼
  Web UI (사용자)
  ├─ 조회 + 간단한 수정
  └─ 승인 → 영상 생성 파이프라인
```

### 전제 조건

- 주인공 캐릭터는 이미 시스템에 등록되어 있음
- 에피소드 등록 전에 해당 에피소드의 캐릭터/장소가 먼저 등록되어야 함
- Claude CLI가 API 호출 순서를 직접 관리

## DB Schema Changes

### 신규 테이블: scene_characters

기존 `episodes`, `scenes` 테이블은 변경 없이 그대로 활용. 씬-캐릭터 연결만 추가.

```sql
CREATE TABLE scene_characters (
  scene_id    NUMBER       REFERENCES scenes(scene_id) ON DELETE CASCADE,
  char_id     VARCHAR2(50) REFERENCES characters(char_id),
  PRIMARY KEY (scene_id, char_id)
);
```

### 기존 테이블 (변경 없음)

**episodes:**
- `ep_id` (PK, auto), `ep_number`, `title`, `synopsis`
- `ep_type` (default 'story'), `status` (default 'draft')
- `script_json` (CLOB), `world_state` (JSON), `decision_reasoning`
- `created_at`, `approved_at`, `published_at`

**scenes:**
- `scene_id` (PK, auto), `ep_id` (FK), `scene_order`
- `description`, `location_id` (FK), `time_of_day`, `camera_type`, `emotion`
- `duration_sec`, `script` (JSON - DialogueLine[])
- `prompt_en`, `motion_prompt`
- `status` (default 'draft')
- `keyframe_path`, `keyframe_blob`, `video_path`, `upscaled_path`, `tts_path`
- `quality_score`, `created_at`

## API Design

### Step 1 & 2: 캐릭터/장소 개별 등록 (이미 구현)

```
POST /api/characters/
  Body: { charId, name, nameEn?, role?, charType?, promptBase? }

POST /api/locations/
  Body: { locationId, name, nameEn?, locationType?, promptBase?, description? }
```

### Step 3: 에피소드+씬 일괄 등록 (신규)

```
POST /api/episodes/
```

**Request Body:**
```json
{
  "epNumber": 4,
  "title": "빗속의 재회",
  "synopsis": "리나가 오래된 카페에서 우연히 김 형사와 마주친다...",
  "epType": "story",
  "decisionReasoning": "시청자 투표에서 재회 루트가 72%를 차지",
  "scenes": [
    {
      "sceneOrder": 1,
      "description": "카페 안, 리나가 창가에 앉아있다",
      "locationId": "cafe_main",
      "characters": ["rina", "detective_kim"],
      "timeOfDay": "afternoon",
      "cameraType": "medium_shot",
      "emotion": "calm",
      "durationSec": 15,
      "script": {
        "direction": "리나가 커피를 마시며 창밖을 바라본다",
        "dialogues": [
          {
            "character": "rina",
            "line": "오늘도 비가 오려나...",
            "emotion": "melancholy",
            "action": "창밖을 바라보며"
          }
        ]
      },
      "promptEn": "young Korean woman sitting by cafe window, soft afternoon light, rain outside, warm interior, photorealistic 8k",
      "motionPrompt": "gentle camera pan from window to character face"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "epId": 4,
  "sceneCount": 12,
  "status": "draft"
}
```

### 조회/수정/승인 엔드포인트 (기존 스텁 구현)

| Method | Endpoint | 용도 |
|--------|----------|------|
| GET | `/api/episodes/` | 에피소드 목록 (status 필터 지원) |
| GET | `/api/episodes/:epId` | 에피소드 상세 (씬+출연캐릭터 포함) |
| PUT | `/api/episodes/:epId` | 에피소드 메타 수정 (title, synopsis) |
| PUT | `/api/episodes/:epId/scenes/:sceneId` | 씬 개별 수정 (대사, 프롬프트 등) |
| POST | `/api/episodes/:epId/approve` | 승인 (status→approved, approved_at 기록) |

### GET /api/episodes/:epId 응답 형태

```json
{
  "success": true,
  "data": {
    "epId": 4,
    "epNumber": 4,
    "title": "빗속의 재회",
    "synopsis": "...",
    "status": "draft",
    "createdAt": "2026-03-30T10:00:00Z",
    "scenes": [
      {
        "sceneId": 1,
        "sceneOrder": 1,
        "description": "카페 안, 리나가 창가에 앉아있다",
        "locationId": "cafe_main",
        "characters": [
          { "charId": "rina", "name": "리나" },
          { "charId": "detective_kim", "name": "김 형사" }
        ],
        "timeOfDay": "afternoon",
        "cameraType": "medium_shot",
        "emotion": "calm",
        "durationSec": 15,
        "script": {
          "direction": "리나가 커피를 마시며 창밖을 바라본다",
          "dialogues": [...]
        },
        "promptEn": "...",
        "motionPrompt": "...",
        "status": "draft"
      }
    ]
  }
}
```

## Service Layer

### episode-service.ts

단일 서비스 파일에 모든 에피소드 비즈니스 로직 구현.

**createEpisode(data) → epId**
1. 트랜잭션 시작
2. `episodes` INSERT → `epId` 반환 (RETURNING 절)
3. 각 씬 순회: `scenes` INSERT → `sceneId` 반환
4. 각 씬의 `characters[]` 순회: `scene_characters` INSERT
5. 커밋 (실패 시 롤백)
6. 반환: `{ epId, sceneCount, status: 'draft' }`

**getEpisodeDetail(epId) → Episode + Scenes + Characters**
1. 에피소드 조회
2. 씬 목록 조회 (scene_order ASC)
3. 씬별 출연 캐릭터 조회 (scene_characters JOIN characters)
4. 조합하여 반환

**updateEpisode(epId, data) → void**
- title, synopsis, decisionReasoning 등 메타 필드만 수정

**updateScene(sceneId, data) → void**
- description, script, promptEn, motionPrompt 등 씬 필드 수정

**approveEpisode(epId) → void**
1. status를 'approved'로 변경
2. approved_at 타임스탬프 기록
3. (향후 확장: 영상 생성 큐에 추가)

## Web UI

기존 뷰 2개의 JS 로직만 구현하면 됨.

### 에피소드 목록 (/episodes → episodes/list.ejs)
- API `GET /api/episodes/` 호출하여 테이블 렌더링
- 상태 필터 탭: 전체 / Draft / Approved / Completed
- 각 행 클릭 → `/episodes/:epId/edit`로 이동
- 상태 뱃지 컬러: draft(회색), approved(녹색), generating(노란색), completed(파란색)

### 에피소드 에디터 (/episodes/:epId/edit → episodes/editor.ejs)
- API `GET /api/episodes/:epId` 호출하여 상세 렌더링
- 상단: 제목/시놉시스 인라인 수정 → `PUT /api/episodes/:epId`
- 씬 카드 목록:
  - 씬 번호, 장소, 시간, 감정 표시
  - 출연 캐릭터 뱃지 목록
  - 대사 목록 (캐릭터명 + 대사 + 감정)
  - 프롬프트 미리보기 (접기/펴기)
  - 인라인 수정 → `PUT /api/episodes/:epId/scenes/:sceneId`
- 하단: "승인 → 영상 생성" 버튼 → `POST /api/episodes/:epId/approve`

## Episode Status Lifecycle

```
draft → approved → generating → completed → published
  ↑        │
  └── 반려 ─┘ (approved에서 draft로 되돌리기 가능)
```

## Validation Rules

### POST /api/episodes/
- `epNumber`: 필수, 중복 불가
- `title`: 필수
- `scenes`: 최소 1개
- 각 씬의 `locationId`: locations 테이블에 존재해야 함 (FK 검증)
- 각 씬의 `characters[]`: characters 테이블에 존재해야 함 (FK 검증)
- `sceneOrder`: 1부터 연속 번호

### PUT /api/episodes/:epId/scenes/:sceneId
- status가 'draft' 또는 'review'일 때만 수정 가능
- approved 이후 수정 시 status를 draft로 되돌림

## File Structure

```
src/episodes/
  ├── types/episode.types.ts          (기존 - characters 필드 추가)
  ├── routes/episode-routes.ts        (기존 스텁 → 실제 구현)
  └── services/episode-service.ts     (신규)

src/db/queries/
  ├── episode-queries.ts              (기존 - 쿼리 추가)
  └── scene-queries.ts                (기존 - scene_characters 쿼리 추가)

src/web/views/episodes/
  ├── list.ejs                        (기존 - JS 로직 연결)
  └── editor.ejs                      (기존 - JS 로직 연결)
```

## Out of Scope

- 영상 생성 파이프라인 연동 (approve 후 큐 등록은 향후 구현)
- Python FastAPI를 통한 Claude API 대본 자동 생성 (CLI에서 직접 생성)
- script_json CLOB 활용 (씬 데이터로 충분, 필요 시 추후 추가)
- world_state JSON 관리 (향후 에피소드 간 연속성 추적 시 구현)
