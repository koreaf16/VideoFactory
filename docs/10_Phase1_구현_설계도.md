# 10. Phase 1 구현 설계도 — 단계별 제작 계획

> 목표: UI 뼈대 + 캐릭터 관리 + 에피소드 관리 + 영상 생성
> "첫 번째 영상이 나오는 것"까지만 집중
> 나머지는 Phase 2 이후 점진 추가
> 2026-03-27

---

## Phase 1 범위 (이것만 만든다)

```
✅ 만드는 것                    ❌ 나중에 하는 것
─────────────                  ──────────────
UI 뼈대 (사이드바+라우팅)        NPC 월드 시뮬레이션
캐릭터 후보 생성/선택             몬스터 도감
캐릭터 레퍼런스 관리              월드맵 관리
에피소드 대본 생성/편집           댓글 수집/분석
영상 생성 (Flux→Wan)            구독자 파워 시스템
TTS 음성 생성                   먹방 레시피 DB
FFmpeg 기본 합성                 강화 시스템
기본 Oracle 스키마               NPC 간 상호작용
                                아이템 비주얼 Tier 2/3
                                자동 레퍼런스 수집
```

---

## 전체 단계 (순서대로 진행)

```
Step 0: 프로젝트 초기화 (Node.js + Python + Oracle)
  ↓
Step 1: UI 뼈대 (사이드바 + 빈 페이지들)
  ↓
Step 2: ComfyUI 연결 (WebSocket 클라이언트)
  ↓
Step 3: 캐릭터 관리 — 후보 생성 + 선택 UI
  ↓
Step 4: 캐릭터 관리 — 앵커 확정 + 파생 + DB 등록
  ↓
Step 5: 에피소드 관리 — 대본 생성 (Claude)
  ↓
Step 6: 에피소드 관리 — 대본 편집 UI + 승인
  ↓
Step 7: 영상 생성 — Flux 키프레임 + Wan 영상
  ↓
Step 8: TTS + FFmpeg 기본 합성
  ↓
Step 9: 첫 번째 영상 완성! 🎉
```

---

## Step 0: 프로젝트 초기화

### 0-1. Node.js 프로젝트

```bash
cd C:\VideoFactory
npm init -y
npm install typescript ts-node @types/node --save-dev
npx tsc --init  # strict: true

npm install express ejs ws oracledb sharp fluent-ffmpeg
npm install @types/express @types/ws --save-dev
```

#### tsconfig.json 핵심 설정

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

### 0-2. Python FastAPI

```bash
cd C:\VideoFactory\ai-services
python -m venv venv
venv\Scripts\activate
pip install fastapi uvicorn httpx anthropic
pip install sentence-transformers insightface onnxruntime-gpu
pip install oracledb
```

### 0-3. Oracle 스키마 (Phase 1 최소)

Phase 1에서 필요한 테이블만:

```sql
-- ======================================
-- 이미지 BLOB 저장 정책
-- ======================================
-- 모든 이미지는 파일 경로 + BLOB 이중 저장
-- image_path: 파일시스템 경로 (ComfyUI output, FFmpeg 등에서 직접 접근)
-- image_blob: Oracle BLOB (백업, 검색, 다른 서버 전송 시 사용)
-- thumbnail_blob: 256px 리사이즈 (웹 UI 그리드용, 빠른 로딩)
-- 원본은 파일시스템에서 작업, BLOB은 보관/복원/이식용

-- 캐릭터 기본
CREATE TABLE characters (
    char_id         VARCHAR2(50) PRIMARY KEY,
    name            VARCHAR2(100) NOT NULL,
    name_en         VARCHAR2(200),
    role            VARCHAR2(100),
    char_type       VARCHAR2(20) DEFAULT 'main',
    profile         JSON,
    appearance      JSON,
    voice_config    JSON,
    mood            JSON,
    face_embedding  VECTOR(512, FLOAT32),
    anchor_blob     BLOB,              -- 앵커 이미지 BLOB
    anchor_thumbnail BLOB,             -- 앵커 썸네일 (256px)
    lora_path       VARCHAR2(500),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 캐릭터 후보 이미지
CREATE TABLE char_candidates (
    candidate_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    char_id         VARCHAR2(50) REFERENCES characters(char_id),
    job_id          VARCHAR2(50),
    image_path      VARCHAR2(500) NOT NULL,
    image_blob      BLOB,              -- 원본 이미지 BLOB
    thumbnail_blob  BLOB,              -- 썸네일 BLOB (256px)
    prompt_text     VARCHAR2(2000),
    seed            NUMBER,
    quality_score   NUMBER(4,3),
    grade           VARCHAR2(5),
    liked           NUMBER(1) DEFAULT 0,
    is_anchor       NUMBER(1) DEFAULT 0,
    image_embedding VECTOR(512, FLOAT32),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 캐릭터 레퍼런스 이미지
CREATE TABLE char_ref_images (
    ref_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    char_id         VARCHAR2(50) REFERENCES characters(char_id),
    image_path      VARCHAR2(500) NOT NULL,
    image_blob      BLOB,              -- 원본 BLOB
    thumbnail_blob  BLOB,              -- 썸네일 BLOB
    pose_tag        VARCHAR2(50),
    image_embedding VECTOR(512, FLOAT32),
    quality_score   NUMBER(4,3),
    approved        NUMBER(1) DEFAULT 1,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ======================================
-- 장소/배경 레퍼런스 (비주얼 일관성)
-- ======================================
-- 장소도 캐릭터처럼 레퍼런스 이미지로 일관성 유지
-- 시간대/날씨별 레퍼런스를 따로 관리

-- 장소 정의
CREATE TABLE locations (
    location_id     VARCHAR2(50) PRIMARY KEY,
    name            VARCHAR2(100) NOT NULL,
    name_en         VARCHAR2(200),
    region_id       VARCHAR2(50),
    location_type   VARCHAR2(30),       -- town/forest/dungeon/market/tavern/road 등
    prompt_base     VARCHAR2(2000),     -- 기본 배경 프롬프트 (항상 포함)
    prompt_variants JSON,               -- { time_of_day: {...}, weather: {...} }
    description     VARCHAR2(500),
    first_ep        NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 장소 레퍼런스 이미지
CREATE TABLE location_ref_images (
    ref_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location_id     VARCHAR2(50) REFERENCES locations(location_id),
    image_path      VARCHAR2(500) NOT NULL,
    image_blob      BLOB,              -- 원본 BLOB
    thumbnail_blob  BLOB,              -- 썸네일 BLOB
    time_of_day     VARCHAR2(20),      -- morning/afternoon/evening/night
    weather         VARCHAR2(20),      -- clear/rain/snow/fog
    angle           VARCHAR2(30),      -- wide/medium/closeup/overhead
    image_embedding VECTOR(512, FLOAT32),
    is_anchor       NUMBER(1) DEFAULT 0,
    quality_score   NUMBER(4,3),
    approved        NUMBER(1) DEFAULT 1,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 아이템 레퍼런스 이미지 (Phase 2지만 테이블은 미리)
CREATE TABLE item_ref_images (
    ref_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id         VARCHAR2(50),
    image_path      VARCHAR2(500) NOT NULL,
    image_blob      BLOB,
    thumbnail_blob  BLOB,
    state           VARCHAR2(20) DEFAULT 'normal',
    angle           VARCHAR2(20),
    image_embedding VECTOR(512, FLOAT32),
    is_anchor       NUMBER(1) DEFAULT 0,
    quality_score   NUMBER(4,3),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ======================================
-- 씬 프레임 저장 (영상 생성 결과)
-- ======================================
-- 키프레임, 영상, 업스케일 결과도 BLOB 보관

-- 에피소드
CREATE TABLE episodes (
    ep_id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ep_number       NUMBER NOT NULL,
    title           VARCHAR2(200),
    synopsis        VARCHAR2(2000),
    ep_type         VARCHAR2(30) DEFAULT 'story',
    status          VARCHAR2(20) DEFAULT 'draft',
    script_json     CLOB,
    world_state     JSON,
    decision_reasoning VARCHAR2(2000),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    approved_at     TIMESTAMP,
    published_at    TIMESTAMP
);

-- 씬
CREATE TABLE scenes (
    scene_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ep_id           NUMBER REFERENCES episodes(ep_id),
    scene_order     NUMBER NOT NULL,
    description     VARCHAR2(500),
    location_id     VARCHAR2(50) REFERENCES locations(location_id),
    time_of_day     VARCHAR2(20),
    camera_type     VARCHAR2(30),
    emotion         VARCHAR2(30),
    duration_sec    NUMBER,
    script          JSON,
    prompt_en       VARCHAR2(2000),
    motion_prompt   VARCHAR2(1000),
    status          VARCHAR2(20) DEFAULT 'draft',
    keyframe_path   VARCHAR2(500),
    keyframe_blob   BLOB,              -- 키프레임 이미지 BLOB
    video_path      VARCHAR2(500),
    upscaled_path   VARCHAR2(500),
    tts_path        VARCHAR2(500),
    quality_score   NUMBER(4,3),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 프롬프트 템플릿
CREATE TABLE prompt_templates (
    template_id     VARCHAR2(50) PRIMARY KEY,
    layer           VARCHAR2(10),
    category        VARCHAR2(50),
    prompt_text     VARCHAR2(2000),
    description     VARCHAR2(200),
    active          NUMBER(1) DEFAULT 1
);

-- 러닝 개그
CREATE TABLE running_gags (
    gag_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    description     VARCHAR2(500),
    trigger_char    VARCHAR2(50),
    last_used_ep    NUMBER,
    usage_count     NUMBER DEFAULT 0,
    active          NUMBER(1) DEFAULT 1
);

-- ======================================
-- BLOB 저장 유틸 (Node.js에서 사용)
-- ======================================
-- 이미지 저장 시 파일 + BLOB 동시 저장하는 헬퍼:
--
-- async function saveImageWithBlob(
--     tableName: string,
--     idColumn: string, 
--     idValue: string | number,
--     imagePath: string
-- ): Promise<void> {
--     const imageBuffer = await fs.readFile(imagePath);
--     const thumbnail = await sharp(imageBuffer).resize(256).jpeg().toBuffer();
--     await db.execute(
--         `UPDATE ${tableName} SET image_blob = :blob, thumbnail_blob = :thumb WHERE ${idColumn} = :id`,
--         { blob: imageBuffer, thumb: thumbnail, id: idValue }
--     );
-- }
```

### 0-4. 디렉토리 생성

```
C:\VideoFactory\
├── CLAUDE.md
├── ARCHITECTURE.md
├── package.json
├── tsconfig.json
├── .env
├── .env.example
│
├── src\
│   ├── app.ts
│   ├── server.ts
│   ├── config.ts
│   │
│   ├── common\
│   │   ├── logger.ts
│   │   ├── errors\
│   │   │   └── app-error.ts
│   │   └── middleware\
│   │       ├── error-handler.ts
│   │       └── async-handler.ts
│   │
│   ├── db\
│   │   ├── connection.ts
│   │   ├── schema.sql
│   │   └── queries\
│   │       ├── character-queries.ts
│   │       ├── episode-queries.ts
│   │       └── scene-queries.ts
│   │
│   ├── comfyui\
│   │   ├── client.ts
│   │   └── workflow-builder.ts
│   │
│   ├── characters\
│   │   ├── routes\
│   │   │   └── character-routes.ts
│   │   ├── services\
│   │   │   ├── candidate-generator.ts
│   │   │   ├── prompt-builder.ts
│   │   │   └── reference-manager.ts
│   │   ├── templates\
│   │   │   ├── global-style.ts
│   │   │   ├── scene-types.ts
│   │   │   └── character-tags.ts
│   │   └── types\
│   │       └── character.types.ts
│   │
│   ├── episodes\
│   │   ├── routes\
│   │   │   └── episode-routes.ts
│   │   ├── services\
│   │   │   └── script-manager.ts
│   │   └── types\
│   │       └── episode.types.ts
│   │
│   ├── video\
│   │   ├── routes\
│   │   │   └── video-routes.ts
│   │   ├── services\
│   │   │   ├── keyframe-generator.ts
│   │   │   ├── video-generator.ts
│   │   │   └── model-switcher.ts
│   │   └── types\
│   │       └── video.types.ts
│   │
│   ├── python-api\
│   │   ├── api-client.ts
│   │   └── endpoints\
│   │       ├── script-api.ts
│   │       ├── embedding-api.ts
│   │       ├── tts-api.ts
│   │       └── quality-api.ts
│   │
│   └── web\
│       ├── routes\
│       │   └── web-routes.ts
│       ├── views\
│       │   ├── layout.ejs
│       │   ├── sidebar.ejs
│       │   ├── dashboard.ejs
│       │   ├── characters\
│       │   │   ├── candidates.ejs
│       │   │   ├── derivatives.ejs
│       │   │   └── manage.ejs
│       │   ├── episodes\
│       │   │   ├── list.ejs
│       │   │   └── editor.ejs
│       │   └── video\
│       │       └── queue.ejs
│       └── public\
│           ├── css\
│           │   └── styles.css
│           └── js\
│               ├── common.js
│               ├── characters.js
│               └── episodes.js
│
├── ai-services\
│   ├── main.py
│   ├── config.py
│   ├── routers\
│   │   ├── health_router.py
│   │   ├── script_router.py
│   │   ├── embedding_router.py
│   │   ├── tts_router.py
│   │   └── quality_router.py
│   ├── services\
│   │   ├── claude\
│   │   │   ├── shorunner.py
│   │   │   └── prompt_templates.py
│   │   ├── embedding\
│   │   │   └── clip_embedder.py
│   │   ├── tts\
│   │   │   └── qwen_tts.py
│   │   └── quality\
│   │       ├── image_scorer.py
│   │       └── face_detector.py
│   ├── db\
│   │   └── oracle_connection.py
│   └── models\
│       ├── script_models.py
│       └── quality_models.py
│
├── scripts\
│   ├── init-oracle.ts
│   └── test-connections.ts
│
└── exports\
```

---

## Step 1: UI 뼈대

### 1-1. Express + EJS 셋업

EJS를 선택 (React보다 가볍고, 서버 렌더링, 빠른 개발).

```typescript
// src/app.ts
import express from 'express';
import path from 'path';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'web/views'));
app.use(express.static(path.join(__dirname, 'web/public')));
app.use(express.json());

// 웹 페이지 라우트
app.use('/', require('./web/routes/web-routes'));

// API 라우트
app.use('/api/characters', require('./characters/routes/character-routes'));
app.use('/api/episodes', require('./episodes/routes/episode-routes'));
app.use('/api/video', require('./video/routes/video-routes'));

export default app;
```

### 1-2. 레이아웃 (사이드바)

```html
<!-- src/web/views/layout.ejs -->
<!-- 
  전체 레이아웃: 왼쪽 사이드바 + 오른쪽 컨텐츠
  모든 페이지가 이 레이아웃을 상속
-->
<html>
<head>
  <title>AI 영상 공장 — <%= title %></title>
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="app-layout">
    <%- include('sidebar') %>
    <main class="content">
      <%- body %>
    </main>
  </div>
  <script src="/js/common.js"></script>
</body>
</html>
```

### 1-3. 사이드바 메뉴 구조

```
AI 영상 공장
├── 대시보드                    ← Step 1에서 빈 페이지
├── [제작]
│   ├── 캐릭터 관리             ← Step 3~4
│   ├── 에피소드 관리           ← Step 5~6
│   └── 영상 생성 큐            ← Step 7~8
├── [세계] (Phase 2)
│   ├── NPC 월드               ← 비활성
│   ├── 장비 / 인벤토리         ← 비활성
│   ├── 몬스터 도감             ← 비활성
│   └── 월드맵                 ← 비활성
├── [시청자] (Phase 2)
│   ├── 댓글 / 신탁             ← 비활성
│   └── 구독자 파워             ← 비활성
├── [컨텐츠] (Phase 2)
│   ├── 먹방 레시피             ← 비활성
│   ├── 강화 이력               ← 비활성
│   └── 컨텐츠 포맷             ← 비활성
└── 설정                       ← Step 0
```

Phase 2 메뉴는 UI에 보이지만 "준비 중" 표시. 나중에 하나씩 활성화.

### 1-4. 웹 라우트

```typescript
// src/web/routes/web-routes.ts
router.get('/', (req, res) => res.render('dashboard', { title: '대시보드' }));
router.get('/characters', (req, res) => res.render('characters/manage', { title: '캐릭터 관리' }));
router.get('/characters/candidates/:jobId', (req, res) => res.render('characters/candidates', { title: '후보 선택' }));
router.get('/characters/derivatives/:charId', (req, res) => res.render('characters/derivatives', { title: '파생 검수' }));
router.get('/episodes', (req, res) => res.render('episodes/list', { title: '에피소드 목록' }));
router.get('/episodes/:epId/edit', (req, res) => res.render('episodes/editor', { title: '대본 편집' }));
router.get('/video/queue', (req, res) => res.render('video/queue', { title: '영상 생성 큐' }));
```

---

## Step 2: ComfyUI 연결

### 2-1. WebSocket 클라이언트

```typescript
// src/comfyui/client.ts
// ComfyUI WebSocket API 클라이언트
// 기능: 연결, 워크플로우 제출, 진행 추적, 결과 수신

export class ComfyUIClient {
    connect(): Promise<void>        // ws://127.0.0.1:8188/ws
    submitWorkflow(wf): Promise<string>  // prompt_id 반환
    waitForResult(promptId): Promise<ImageResult>
    getSystemStats(): Promise<SystemStats>
}
```

### 2-2. 워크플로우 빌더

```typescript
// src/comfyui/workflow-builder.ts
// Flux 2 Klein 9B 워크플로우 JSON을 동적으로 생성

export function buildFluxWorkflow(opts: {
    prompt: string;
    seed: number;
    width?: number;    // default 1024
    height?: number;   // default 1024
    steps?: number;    // default 20
    cfg?: number;      // default 3.5
}): ComfyUIWorkflow
```

### 2-3. 연결 테스트

```typescript
// scripts/test-connections.ts
// ComfyUI + Oracle + Python FastAPI 3개 연결 테스트
```

---

## Step 3: 캐릭터 후보 생성 + 선택 UI

### 3-1. 프롬프트 빌더

```typescript
// src/characters/services/prompt-builder.ts
// 캐릭터 프로필 → 프롬프트 변형 50개 생성

export function generateCandidatePrompts(
    charProfile: CharacterProfile,
    count: number  // default 50
): string[]

// 변형 축:
// - 표정: smile, serious, surprised, angry, neutral (5)
// - 각도: front, quarter, side (3)
// - 조명: daylight, golden_hour, overcast (3)
// → 5 × 3 × 3 = 45개 + 랜덤 5개 = 50개
```

### 3-2. 후보 생성 API

```
POST /api/characters/generate-candidates
Body: { charId: "soyul", count: 50 }
Response: { jobId: "job_xxx", status: "generating" }

내부 흐름:
1. DB에서 캐릭터 프로필 로드
2. prompt-builder로 50개 프롬프트 생성
3. ComfyUI에 50개 배치 제출
4. 결과 이미지 저장 → char_candidates INSERT
5. Python에 품질 스코어링 요청 → 등급 부여
```

### 3-3. 후보 선택 UI

```
GET /characters/candidates/:jobId

화면 구성:
┌──────────────────────────────────────┐
│ 캐릭터 후보 선택 — 소율                │
│ 정렬: [점수순▼]  필터: [전체▼]        │
│                                      │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ │
│ │ S  │ │ S  │ │ A  │ │ A  │ │ A  │ │
│ │ ♥  │ │    │ │ ♥  │ │    │ │    │ │
│ └────┘ └────┘ └────┘ └────┘ └────┘ │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ │
│ │ ...│                               │
│                                      │
│ [이 느낌으로 더 생성] [앵커로 확정]    │
└──────────────────────────────────────┘

API 연동:
- 이미지 클릭 → 모달 확대
- 하트 클릭 → POST /api/characters/candidates/:jobId/like
- "앵커로 확정" → POST /api/characters/candidates/:jobId/anchor
- "이 느낌으로 더 생성" → POST /api/characters/candidates/:jobId/more
```

---

## Step 4: 앵커 확정 + 파생 + DB 등록

### 4-1. 앵커 확정 시 자동 처리

```
POST /api/characters/candidates/:jobId/anchor
Body: { anchorCandidateId: 3 }

내부 흐름:
1. 해당 후보를 is_anchor = 1로 업데이트
2. CLIP 임베딩 추출 → characters.face_embedding 저장
3. IP-Adapter 참조로 다각도 파생 자동 시작
   - 정면, 45도, 측면, 웃음, 놀람, 화남, 전신 등 15~20장
4. 파생 결과 → char_ref_images INSERT
```

### 4-2. 파생 검수 UI

```
GET /characters/derivatives/:charId

화면 구성:
┌──────────────────────────────────────┐
│ 파생 이미지 검수 — 소율                │
│ ┌──────┐ ← 앵커 이미지 (고정)        │
│ │      │                             │
│ └──────┘                             │
│                                      │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ │
│ │정면│ │45도│ │측면│ │웃음│ │놀람│ │
│ │ ✓ │ │ ✓ │ │ ✓ │ │ ✓ │ │ ✗ │ │
│ └────┘ └────┘ └────┘ └────┘ └────┘ │
│                                      │
│ [불량 재생성] [레퍼런스 세트 확정]      │
└──────────────────────────────────────┘

"확정" 시:
- approved = 1인 이미지만 최종 레퍼런스로
- 캐릭터 상태를 "confirmed"로 업데이트
```

---

## Step 5: 에피소드 대본 생성

### 5-1. 대본 생성 API

```
POST /api/episodes/generate
Body: { epNumber: 1, epType: "story" }

내부 흐름:
1. Node.js → Python FastAPI 호출
   POST http://localhost:8000/api/script/generate
   Body: { ep_number, ep_type, characters, previous_episodes }

2. Python에서:
   a. Oracle에서 캐릭터 상태 + 최근 줄거리 로드
   b. Claude API 호출 (시스템 프롬프트 + 컨텍스트)
   c. 대본 JSON 파싱 + 검증
   d. 반환

3. Node.js에서:
   a. episodes INSERT (status: 'draft')
   b. scenes 씬별 INSERT
   c. 응답: { epId, title, scenes[] }
```

### 5-2. Claude 호출 (Python)

```python
# ai-services/services/claude/shorunner.py

async def generate_episode_script(
    ep_number: int,
    ep_type: str,
    characters: list[dict],
    previous_episodes: list[dict],
    running_gags: list[dict],
) -> EpisodeScript:
    """
    Claude에 대본 생성 요청.
    
    Phase 1에서는 단순 버전:
    - Oracle 컨텍스트 = 캐릭터 프로필 + 최근 EP 줄거리
    - 댓글 분석 없음 (Phase 2)
    - NPC 시뮬 없음 (Phase 2)
    """
```

---

## Step 6: 대본 편집 UI + 승인

### 6-1. 대본 편집 화면

```
GET /episodes/:epId/edit

화면 구성:
┌──────────────────────────────────────┐
│ EP.01 대본 편집                       │
│ 제목: "여러분 저 이상한 데 왔는데..."   │
│ 줄거리: [편집 가능 텍스트]             │
│                                      │
│ ┌─ 씬 1 ─────────────────────────┐  │
│ │ 장소: 학교 옥상 | 오후 | 셀카    │  │
│ │                                │  │
│ │ 소율: "여러분 안녕하세요~"       │  │
│ │ (지문) 컵라면 먹으며 ...        │  │
│ │                                │  │
│ │ 프롬프트: [편집 가능]            │  │
│ │ [씬 재생성] [삭제]              │  │
│ └────────────────────────────────┘  │
│                                      │
│ ┌─ 씬 2 ─────────────────────────┐  │
│ │ ...                            │  │
│ └────────────────────────────────┘  │
│                                      │
│ [전체 재생성] [승인 → 영상 생성]       │
└──────────────────────────────────────┘
```

### 6-2. API

```
GET    /api/episodes/:epId           대본 조회
PUT    /api/episodes/:epId           대본 수정 (제목, 줄거리)
PUT    /api/episodes/:epId/scenes/:id  씬 수정 (대사, 프롬프트)
POST   /api/episodes/:epId/scenes/:id/regenerate  씬 재생성
POST   /api/episodes/:epId/approve   승인 → 영상 생성 시작
```

---

## Step 7: 영상 생성

### 7-1. 영상 생성 파이프라인

```
POST /api/episodes/:epId/generate-video
→ 승인된 에피소드의 전체 씬을 영상으로 생성

내부 흐름:

[Pass 1 — Flux 키프레임]
  씬 1 프롬프트 → Flux Klein 9B → 키프레임 이미지
  씬 2 프롬프트 → Flux Klein 9B → 키프레임 이미지
  ...
  → 품질 검증 (Python) → 불량 재생성
  → scenes.keyframe_path 업데이트

[모델 전환]
  Flux 언로드 → Wan 2.2 로드

[Pass 2 — Wan 영상]
  씬 1 키프레임 + 모션 프롬프트 → Wan 2.2 I2V → 영상
  씬 2 키프레임 + 모션 프롬프트 → Wan 2.2 I2V → 영상
  ...
  → scenes.video_path 업데이트

[업스케일]
  각 씬 영상 → Real-ESRGAN x4
  → scenes.upscaled_path 업데이트
```

### 7-2. 모델 전환

```typescript
// src/video/services/model-switcher.ts
// Flux ↔ Wan 모델 전환 관리
// 3090 24GB에서 동시 로드 불가 → 순차 처리

export async function switchToFlux(): Promise<void>
export async function switchToWan(): Promise<void>
export async function unloadAll(): Promise<void>
```

### 7-3. 영상 생성 큐 UI

```
GET /video/queue

화면 구성:
┌──────────────────────────────────────┐
│ 영상 생성 큐                          │
│                                      │
│ EP.01 — 진행중 (씬 3/7)              │
│ ┌──────────────────────────────────┐ │
│ │ Pass 1 (Flux) [████████░░] 80%  │ │
│ │ 씬 1 ✓ 씬 2 ✓ 씬 3 ⏳ 씬 4 ○  │ │
│ │ 씬 5 ○ 씬 6 ○ 씬 7 ○          │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 예상 완료: 약 2시간 30분              │
│ GPU 사용: 18GB / 24GB                │
└──────────────────────────────────────┘
```

---

## Step 8: TTS + FFmpeg 기본 합성

### 8-1. TTS 생성

```
Node.js → Python FastAPI
POST http://localhost:8000/api/tts/generate
Body: { 
    scenes: [
        { dialogues: [{ char: "소율", line: "...", speaker: "sohee" }] }
    ]
}
→ WAV 파일 반환
→ scenes.tts_path 업데이트
```

### 8-2. FFmpeg 기본 합성

Phase 1에서는 최소한의 합성만:

```typescript
// src/video/services/basic-composer.ts
// Phase 1: 기본 합성만
// - 씬별 영상 + TTS 음성 합치기
// - 씬 간 페이드 전환
// - 최종 MP4 출력

// Phase 2에서 추가:
// - 스마트폰 UI 오버레이
// - 손떨림
// - 댓글 텍스트
// - 환경음/BGM
// - 글리치 이펙트
```

```
FFmpeg 명령 (기본):
1. 각 씬 영상 + TTS 오디오 합성
   ffmpeg -i scene1.mp4 -i scene1_tts.wav -c:v copy -c:a aac output_scene1.mp4

2. 모든 씬을 순서대로 연결
   ffmpeg -f concat -i filelist.txt -c copy final_ep01.mp4
```

---

## Step 9: 첫 번째 영상 완성!

### 검증 체크리스트

```
□ 캐릭터 4명 레퍼런스 이미지 확정됨
□ EP01 대본 생성 + 승인됨
□ 전체 씬 키프레임 이미지 생성됨 (Flux)
□ 전체 씬 영상 생성됨 (Wan)
□ 업스케일 완료
□ TTS 음성 생성됨
□ FFmpeg 합성 완료
□ 최종 MP4 재생 확인
```

### 결과물

```
C:\VideoFactory\exports\ep01\
├── keyframes\
│   ├── scene1.png
│   ├── scene2.png
│   └── ...
├── videos\
│   ├── scene1_raw.mp4
│   ├── scene1_upscaled.mp4
│   └── ...
├── audio\
│   ├── scene1_tts.wav
│   └── ...
└── final_ep01.mp4          ← 최종 결과물!
```

---

## Phase 2 이후 추가 순서

Phase 1이 완성되면 아래 순서로 하나씩 추가:

| 순서 | 기능 | 의존성 |
|------|------|--------|
| P2-1 | FFmpeg 후처리 강화 (스마트폰 UI, 손떨림) | Phase 1 완료 |
| P2-2 | 댓글 수집 + 분석 (YouTube API) | Phase 1 완료 |
| P2-3 | NPC 월드 기본 (일과, 위치) | Oracle 스키마 추가 |
| P2-4 | 장비/인벤토리 시스템 | Oracle 스키마 추가 |
| P2-5 | 구독자 파워 시스템 | 댓글 수집 필요 |
| P2-6 | 아이템 비주얼 Tier 2 (레퍼런스) | 캐릭터 관리 재활용 |
| P2-7 | 강화 시스템 | 장비 시스템 필요 |
| P2-8 | 먹방 레시피 DB | Oracle 스키마 추가 |
| P2-9 | 컨텐츠 포맷 자동 추천 | 댓글 분석 필요 |
| P2-10 | NPC 랜덤 이벤트 + 상호작용 | NPC 월드 기본 필요 |
| P2-11 | 몬스터 도감 | Oracle 스키마 추가 |
| P2-12 | 월드맵 관리 | 지역 DB 필요 |
| P2-13 | LoRA 학습 관리 | 캐릭터 레퍼런스 필요 |
| P2-14 | 자동 레퍼런스 수집 | 모든 기본 시스템 필요 |

---

## Claude Code에 전달할 명령

### 첫 번째 명령 (Step 0~1)

```
CLAUDE.md와 ARCHITECTURE.md를 읽어줘.

그다음 이 프로젝트를 초기화해줘:
1. package.json + tsconfig.json 생성
2. npm install (express, ejs, ws, oracledb, sharp, fluent-ffmpeg)
3. 디렉토리 구조 전부 생성 (이 문서의 Step 0-4 참고)
4. src/app.ts + src/server.ts 기본 뼈대
5. src/web/views/layout.ejs + sidebar.ejs (한국어 사이드바)
6. src/web/views/dashboard.ejs (빈 대시보드)
7. .env.example 생성
8. Oracle 스키마 SQL (src/db/schema.sql)
9. 서버 시작해서 http://localhost:3000 에서 사이드바가 보이는지 확인

모든 UI 텍스트는 한국어로.
CLAUDE.md 규칙 따라서 파일 상단 주석, 200줄 이하, any 금지.
```
