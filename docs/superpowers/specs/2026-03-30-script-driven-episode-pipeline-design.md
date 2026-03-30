# Script-Driven Episode Pipeline Design

**Date:** 2026-03-30
**Status:** Draft
**Supersedes:** script-registration-system-design.md

## Overview

Claude CLI가 마스터 대본을 생성하고, 거기서 씬을 하나씩 만들어내며, 필요한 캐릭터/장소를 특정하여 DB에 등록하는 파이프라인. MCP 서버를 통해 Claude CLI가 DB와 자연스럽게 상호작용한다.

**MVP 범위:** 주인공 캐릭터 1명 + 장소 1개, 테스트 씬 1개

## Workflow

```
Claude CLI (창작 엔진, MCP 도구 사용)
  │
  ├─ 1. 마스터 대본 생성 → DB (MASTER_SCRIPTS)
  │     └─ 장르, 세계관, 전체 시놉시스
  │
  ├─ 2. 씬 생성 (하나씩) → DB (EPISODES + SCENES)
  │     ├─ 기존 캐릭터/장소 조회 (list_characters, list_locations)
  │     ├─ 필요 시 새 캐릭터/장소 등록
  │     └─ 씬에 캐릭터/장소 매핑
  │
  └─ 3. 반복 (마스터 대본에 기반하여 씬 계속 추가)
         │
         ▼
  웹 UI (사용자 검수/제작)
  ├─ 마스터 대본 조회
  ├─ 에피소드/씬 검수 + 편집
  ├─ 스틸컷 미리보기 (ComfyUI)
  └─ 영상 제작
```

## DB Schema Changes

### 신규 테이블: MASTER_SCRIPTS

```sql
CREATE TABLE master_scripts (
  script_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         VARCHAR2(200)  NOT NULL,
  genre         VARCHAR2(100),
  synopsis      CLOB,
  world_setting CLOB,
  status        VARCHAR2(20) DEFAULT 'active'
                CHECK (status IN ('draft','active','completed','archived')),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 기존 테이블 변경: EPISODES

```sql
ALTER TABLE episodes ADD (
  script_id NUMBER REFERENCES master_scripts(script_id)
);
```

에피소드가 어느 마스터 대본에 속하는지 연결. NULL 허용 (기존 에피소드 호환).

### 기존 테이블 (변경 없음)

- **scenes** — `location_id` FK로 장소 매핑 (이미 있음)
- **scene_characters** — 씬-캐릭터 다대다 매핑 (이미 있음)
- **characters** — 캐릭터 마스터 (이미 있음)
- **locations** — 장소 마스터 (이미 있음)

## MCP Server Design

### 아키텍처

```
Claude CLI
  │ (MCP Protocol - stdio)
  ▼
MCP Server (Node.js, 독립 프로세스)
  │ (HTTP)
  ▼
Express API (localhost:3000)
  │
  ▼
Oracle DB
```

MCP 서버는 기존 REST API를 래핑하는 thin wrapper. DB 로직을 중복하지 않는다.

### 파일 구조

```
src/mcp/
  ├── server.ts              (MCP 서버 진입점)
  ├── tools/
  │   ├── master-script.ts   (마스터 대본 CRUD 도구)
  │   ├── episode.ts         (에피소드/씬 생성 도구)
  │   └── resource.ts        (캐릭터/장소 조회 도구)
  └── types/
      └── mcp.types.ts       (MCP 도구 입출력 타입)
```

### MCP 도구 목록 (MVP: 6개)

| 도구 | 역할 | 래핑 API |
|------|------|----------|
| `create_master_script` | 마스터 대본 생성 | POST /api/master-scripts |
| `get_master_script` | 마스터 대본 조회 | GET /api/master-scripts/:id |
| `create_episode_with_scenes` | 에피소드+씬 일괄 생성 | POST /api/episodes |
| `list_characters` | 등록된 캐릭터 목록 | GET /api/characters |
| `list_locations` | 등록된 장소 목록 | GET /api/locations |
| `get_episode_detail` | 에피소드 상세 조회 | GET /api/episodes/:epId |

### MCP 도구 상세

#### create_master_script

```typescript
input: {
  title: string          // 필수
  genre?: string         // "코미디/판타지", "액션" 등
  synopsis?: string      // 전체 시놉시스
  worldSetting?: string  // 세계관 설명
}
output: {
  scriptId: number
  title: string
  status: "active"
}
```

#### get_master_script

```typescript
input: {
  scriptId: number
}
output: {
  scriptId: number
  title: string
  genre: string
  synopsis: string
  worldSetting: string
  status: string
  episodes: Array<{ epId, epNumber, title, status }>  // 소속 에피소드 목록
}
```

#### create_episode_with_scenes

```typescript
input: {
  scriptId: number       // 소속 마스터 대본
  epNumber: number
  title: string
  synopsis?: string
  scenes: Array<{
    sceneOrder: number
    description?: string
    locationId?: string       // 기존 장소 ID (MVP)
    characters?: string[]     // 기존 캐릭터 ID 배열 (MVP)
    timeOfDay?: string
    cameraType?: string
    emotion?: string
    durationSec?: number
    script?: {
      direction?: string
      dialogues: Array<{
        character: string
        line: string
        emotion?: string
        action?: string
      }>
    }
    promptEn?: string
    motionPrompt?: string
  }>
}
output: {
  epId: number
  sceneCount: number
  status: "draft"
}
```

#### list_characters

```typescript
input: {}  // 파라미터 없음
output: {
  characters: Array<{
    charId: string
    name: string
    role?: string
    hasLora: boolean       // LoRA 학습 여부
    refImageCount: number  // 레퍼런스 이미지 수
  }>
}
```

#### list_locations

```typescript
input: {}
output: {
  locations: Array<{
    locationId: string
    name: string
    locationType?: string
    refImageCount: number
  }>
}
```

### Claude CLI 설정

`.claude/settings.json`에 MCP 서버 등록:

```json
{
  "mcpServers": {
    "videofactory": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "env": {
        "API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## REST API Changes

### 신규 엔드포인트

| Method | Endpoint | 용도 |
|--------|----------|------|
| POST | `/api/master-scripts` | 마스터 대본 생성 |
| GET | `/api/master-scripts` | 마스터 대본 목록 |
| GET | `/api/master-scripts/:scriptId` | 마스터 대본 상세 (소속 에피소드 포함) |
| PUT | `/api/master-scripts/:scriptId` | 마스터 대본 수정 |

### 기존 엔드포인트 변경

- `POST /api/episodes` — `scriptId` 필드 추가 (optional)
- `GET /api/episodes` — `scriptId` 쿼리 파라미터 필터 추가

## Web UI Changes

### 에피소드 목록 (list.ejs)

- "새 에피소드 생성" 버튼 → `/episodes/new` 페이지 (수동 생성용, 백업)
- 마스터 대본 필터 드롭다운 추가
- Claude CLI로 생성된 에피소드도 동일하게 표시

### 마스터 대본 페이지 (신규)

- `/scripts` → 마스터 대본 목록
- `/scripts/:scriptId` → 마스터 대본 상세 + 소속 에피소드 목록
- 읽기 전용 (수정은 Claude CLI에서)

## MVP 시나리오

### 전제 조건
- 주인공 캐릭터 "soyul" 이미 DB에 등록
- 장소 1개 이상 DB에 등록

### Claude CLI 세션 예시

```
사용자: 소율이의 첫 번째 에피소드를 만들어줘

Claude CLI:
  1. list_characters() → soyul 확인
  2. list_locations() → 사용 가능 장소 확인
  3. create_master_script({
       title: "이세계 유튜버 한소율",
       genre: "코미디/판타지",
       synopsis: "고등학생 유튜버가 이세계에서 모험하는 이야기",
       worldSetting: "현대 한국 + 판타지 이세계..."
     })
  4. create_episode_with_scenes({
       scriptId: 1,
       epNumber: 1,
       title: "시작은 언제나 갑작스럽게",
       scenes: [{
         sceneOrder: 1,
         description: "소율이 방에서 영상 촬영 중 갑자기 이세계로...",
         locationId: "soyul_room",
         characters: ["soyul"],
         emotion: "surprised",
         ...
       }]
     })
```

### 사용자 검수 (Web UI)

1. `/episodes` 에서 새 에피소드 확인
2. 씬 편집기에서 대사/프롬프트 수정
3. 스틸컷 미리보기 생성
4. 승인 → 영상 제작 큐

## Future Expansion (Out of Scope for MVP)

- 다중 캐릭터 + 캐릭터 관계도
- 아이템 시스템 (무기, 도구, 마법 아이템)
- 몬스터/NPC 시스템
- 세계 지도 + 지역 이동
- 전자동 파이프라인 (Claude API → 대본 → 이미지 → 영상)
- 시청자 댓글 기반 스토리 분기
- world_state JSON 활용 (에피소드 간 연속성)

## File Structure (전체)

```
src/mcp/
  ├── server.ts
  ├── tools/
  │   ├── master-script.ts
  │   ├── episode.ts
  │   └── resource.ts
  └── types/
      └── mcp.types.ts

src/master-scripts/
  ├── routes/
  │   └── master-script-routes.ts
  ├── services/
  │   └── master-script-service.ts
  └── types/
      └── master-script.types.ts

src/db/queries/
  └── master-script-queries.ts    (신규)

src/db/migrations/
  └── 005-master-scripts.ts       (신규)

src/web/views/
  └── scripts/
      ├── list.ejs                (신규)
      └── detail.ejs              (신규)
```
