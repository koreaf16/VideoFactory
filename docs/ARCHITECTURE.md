# ARCHITECTURE.md — 시스템 아키텍처

> 이 문서는 프로젝트의 **현재 상태**를 반영합니다.
> 구조 변경 시 **반드시** 이 문서를 업데이트하세요.
> 마지막 업데이트: 2026-03-28

---

## 시스템 전체 구조

### 역할 분리 원칙

| 담당 | Node.js (TypeScript) | Python (FastAPI) |
|------|---------------------|------------------|
| 핵심 역할 | 오케스트레이션 + 웹 UI | **AI/LLM 전담** |
| 구체적 | ComfyUI 제어, FFmpeg, 웹 서버, 큐 관리 | Claude, TTS, 임베딩, 분석, 품질 판정 |
| DB 접근 | 일반 CRUD (캐릭터, 에피소드, 큐 상태) | **컨텍스트 수집 + Vector/Graph 검색** |
| 원칙 | **LLM/AI 모델에 직접 접촉하지 않음** | **LLM과 닿는 모든 것은 여기서** |

```
┌─ YouTube API ──────────────────────────────────────────┐
│  댓글 수집 / 업로드 / Analytics / CC0 소스              │
└────────────────────────┬───────────────────────────────┘
                         ↕
┌─ Node.js Orchestrator (Express + TypeScript, :3000) ───┐
│                                                         │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐     │
│  │ 캐릭터   │ │ 에피소드  │ │ ComfyUI│ │ 생성 큐   │     │
│  │ 관리    │ │ 관리     │ │ 클라이언트│ │ (BullMQ) │     │
│  └────┬────┘ └────┬─────┘ └───┬────┘ └────┬─────┘     │
│       └───────────┴───────────┴───────────┘            │
│  ┌──────────┐ ┌──────────────────────────────┐         │
│  │ FFmpeg   │ │    관리 웹 UI (HTML+Tailwind) │         │
│  │ 후처리   │ └──────────────────────────────┘         │
│  └──────────┘                                           │
│  ※ LLM/AI 모델 직접 호출 안 함 — 전부 Python에 위임     │
└──────┬──────────────────────────────────┬──────────────┘
       ↕ REST (AI 요청)                   ↕ WebSocket
┌─ Python FastAPI (:8000) ─────────────┐  ┌─ ComfyUI (:8188) ──┐
│  ★ LLM/AI 연동 전담 서버              │  │  Flux 2 Klein 9B   │
│                                      │  │  Flux 2 Dev        │
│  ┌─ 대본 생성 ─────────────────────┐ │  │  Wan 2.2 I2V       │
│  │ Oracle 컨텍스트 수집 (6가지)     │ │  │  Real-ESRGAN       │
│  │ Claude 쇼러너 호출              │ │  │  IP-Adapter + LoRA  │
│  │ 대본 JSON 반환                 │ │  └────────┬───────────┘
│  └─────────────────────────────────┘ │           │
│  ┌─ 임베딩/분석 ───────────────────┐ │           │
│  │ CLIP 이미지/텍스트 임베딩       │ │           │
│  │ MiniLM 댓글 임베딩             │ │           │
│  │ wav2vec2 음성 임베딩           │ │           │
│  │ 댓글 클러스터링 + 감정 분석     │ │           │
│  │ Vector 유사도 검색             │ │           │
│  └─────────────────────────────────┘ │           │
│  ┌─ 음성/품질 ─────────────────────┐ │           │
│  │ Qwen3-TTS (음성 생성)          │ │           │
│  │ Whisper (자막 생성)            │ │           │
│  │ 이미지 품질 스코어링 (CLIP)     │ │           │
│  │ 프롬프트 최적화                │ │           │
│  └─────────────────────────────────┘ │           │
└──────────┬───────────────────────────┘           │
           ↕                                        ↕
┌─ Oracle AI Database 26ai ────────────────────────────┐
│                                                       │
│  Node.js 접근: 일반 CRUD (INSERT/UPDATE/SELECT)       │
│  Python 접근:  Vector 검색 + Graph 쿼리 + 컨텍스트     │
│                                                       │
│  Vector DB │ Graph │ Relational │ JSON Duality         │
│  Unified Hybrid Search (단일 SQL 통합 조회)             │
└───────────────────────────────────────────────────────┘
```

---

## 디렉토리 구조

```
C:\VideoFactory\
│
├── CLAUDE.md                          ★ Claude Code 지침서
├── ARCHITECTURE.md                    ★ 이 파일 (항상 최신 유지)
├── .env                               환경 변수 (git 무시)
├── .env.example                       환경 변수 템플릿
├── .gitignore
├── package.json
├── tsconfig.json
│
├── docs/                              📚 설계 문서
│   ├── design/                        파이프라인 설계
│   │   ├── 01_전체_시스템_아키텍처.md
│   │   ├── 02_설치_가이드.md
│   │   ├── 03_캐릭터_생성_파이프라인.md
│   │   ├── 04_대본_생성_파이프라인.md
│   │   ├── 05_영상_생성_파이프라인.md
│   │   ├── 06_후처리_배포_파이프라인.md
│   │   ├── 07_NPC_살아있는_세계_시스템.md
│   │   ├── 08_세계관_장비_몬스터_월드맵.md
│   │   ├── 09_유튜브_컨텐츠_포맷.md
│   │   └── 10_Phase1_구현_설계도.md
│   ├── api/                           API 명세
│   │   ├── characters.md
│   │   ├── episodes.md
│   │   ├── comments.md
│   │   └── queue.md
│   ├── worldbuilding/                 세계관 문서
│   │   ├── 이세계_유튜버_로드맵.md
│   │   ├── 캐릭터_프로필.md
│   │   ├── 시즌1_스토리라인.md
│   │   └── 파워시스템_구독자_마력.md
│   └── changelog.md                   변경 이력
│
├── src/                               🔧 소스 코드
│   ├── app.ts                         Express 앱 진입점
│   ├── server.ts                      서버 시작 (포트, 미들웨어)
│   ├── config.ts                      환경 변수 + 설정값 로드
│   │
│   ├── common/                        🔗 공통 모듈
│   │   ├── README.md
│   │   ├── logger.ts                  로깅 (console.log 대체)
│   │   ├── errors/
│   │   │   ├── app-error.ts           기본 에러 클래스
│   │   │   ├── comfyui-error.ts       ComfyUI 관련 에러
│   │   │   ├── oracle-error.ts        Oracle 관련 에러
│   │   │   └── validation-error.ts    입력 검증 에러
│   │   ├── middleware/
│   │   │   ├── error-handler.ts       글로벌 에러 핸들러
│   │   │   ├── request-logger.ts      요청 로깅
│   │   │   └── async-handler.ts       async 래퍼
│   │   └── utils/
│   │       ├── file-utils.ts          파일 I/O 헬퍼
│   │       ├── image-utils.ts         이미지 처리 (sharp)
│   │       └── time-utils.ts          시간/타임스탬프
│   │
│   ├── db/                            🗄️ Oracle 26ai
│   │   ├── README.md
│   │   ├── connection.ts              연결 풀 관리
│   │   ├── schema.sql                 전체 DDL (테이블+인덱스+그래프)
│   │   ├── seed.sql                   초기 데이터 (러닝 개그, 세계관)
│   │   ├── queries/                   SQL 쿼리 (도메인별 분리)
│   │   │   ├── character-queries.ts   캐릭터 CRUD
│   │   │   ├── episode-queries.ts     에피소드 CRUD
│   │   │   ├── comment-queries.ts     댓글 CRUD
│   │   │   ├── reference-queries.ts   레퍼런스 CRUD
│   │   │   ├── lora-queries.ts        LoRA 5개 테이블 SQL (datasets, images, jobs, checkpoints, evals)
│   │   │   ├── vector-search.ts       Vector 유사도 검색
│   │   │   ├── graph-relations.ts     Graph 관계 쿼리 (GRAPH_TABLE)
│   │   │   └── json-profile.ts        JSON Duality 쿼리
│   │   └── migrations/                스키마 변경 이력
│   │       └── 001_initial.sql
│   │
│   ├── characters/                    👤 캐릭터 생성 파이프라인
│   │   ├── README.md
│   │   ├── routes/
│   │   │   ├── character-routes.ts    /api/characters/* 라우트
│   │   │   └── lora-routes.ts         /api/lora/* 라우트 (12 엔드포인트)
│   │   ├── services/
│   │   │   ├── candidate-generator.ts 후보 이미지 배치 생성 (Kontext)
│   │   │   ├── prompt-builder.ts      프롬프트 3계층 조합
│   │   │   ├── quality-scorer.ts      품질 자동 스코어링
│   │   │   ├── anchor-selector.ts     앵커 이미지 확정 처리
│   │   │   ├── derivative-generator.ts Kontext 편집 기반 파생
│   │   │   ├── derivative-presets.ts  파생 프리셋 (포즈/표정/앵글)
│   │   │   ├── reference-manager.ts   레퍼런스 세트 관리 + DB 등록
│   │   │   ├── lora-dataset.ts        LoRA 데이터셋 생성 + Florence-2 캡셔닝
│   │   │   └── lora-training.ts       LoRA 학습 실행 + 추론 테스트
│   │   ├── types/
│   │   │   ├── character.types.ts     캐릭터 관련 인터페이스
│   │   │   └── lora.types.ts          LoRA 도메인 인터페이스
│   │   └── templates/
│   │       ├── global-style.ts        Layer 1 글로벌 스타일 프롬프트
│   │       ├── scene-types.ts         Layer 2 씬 타입 6종 프리셋
│   │       ├── character-tags.ts      캐릭터별 고정 외모 태그
│   │       ├── time-weather.ts        시간/날씨 프롬프트 프리셋
│   │       └── negative-prompts.ts    네거티브 프롬프트
│   │
│   ├── episodes/                      📝 대본 생성 파이프라인
│   │   ├── README.md
│   │   ├── routes/
│   │   │   └── episode-routes.ts      /api/episodes/* 라우트
│   │   ├── services/
│   │   │   ├── context-assembler.ts   Oracle 6가지 컨텍스트 수집
│   │   │   ├── script-generator.ts    Claude 쇼러너 호출 + 대본 JSON
│   │   │   ├── oracle-hook.ts         신탁의 시간 코너 생성
│   │   │   ├── script-validator.ts    대본 JSON 검증
│   │   │   └── world-state-updater.ts 세계 상태 변경 (Graph/JSON)
│   │   └── types/
│   │       └── episode.types.ts       에피소드/씬 인터페이스
│   │
│   ├── video/                         🎬 영상 생성 파이프라인
│   │   ├── README.md
│   │   ├── routes/
│   │   │   └── video-routes.ts        /api/video/* 라우트
│   │   ├── services/
│   │   │   ├── keyframe-generator.ts  Pass 1: Flux 키프레임 이미지
│   │   │   ├── video-generator.ts     Pass 2: Wan 2.2 I2V 영상
│   │   │   ├── model-switcher.ts      Flux↔Wan 모델 전환 제어
│   │   │   ├── upscaler.ts            Real-ESRGAN 업스케일
│   │   │   └── video-validator.ts     영상 품질 검증
│   │   └── types/
│   │       └── video.types.ts         영상 생성 인터페이스
│   │
│   ├── audio/                         🔊 음성/음악 파이프라인
│   │   ├── README.md
│   │   ├── services/
│   │   │   ├── tts-generator.ts       Qwen3-TTS 호출 (Python 브릿지)
│   │   │   ├── bgm-selector.ts        BGM 자동 선택 (Vector Search)
│   │   │   └── sfx-selector.ts        효과음 자동 선택
│   │   └── types/
│   │       └── audio.types.ts
│   │
│   ├── postprocess/                   🎞️ 후처리 파이프라인
│   │   ├── README.md
│   │   ├── services/
│   │   │   ├── ffmpeg-composer.ts     FFmpeg 메인 합성
│   │   │   ├── smartphone-overlay.ts  스마트폰 UI 오버레이
│   │   │   ├── camera-effects.ts      손떨림 + 노이즈 + 렌즈
│   │   │   ├── comment-overlay.ts     댓글 텍스트 삽입
│   │   │   ├── glitch-effects.ts      글리치 이펙트 (4th wall)
│   │   │   └── audio-mixer.ts         환경음 + BGM + TTS 믹싱
│   │   └── types/
│   │       └── postprocess.types.ts
│   │
│   ├── comments/                      💬 댓글 분석 파이프라인
│   │   ├── README.md
│   │   ├── routes/
│   │   │   └── comment-routes.ts      /api/comments/* 라우트
│   │   ├── services/
│   │   │   ├── youtube-fetcher.ts     YouTube API 댓글 수집
│   │   │   ├── comment-analyzer.ts    임베딩 + 클러스터링
│   │   │   ├── sentiment-scorer.ts    감정 분석 + NPC 인기도
│   │   │   └── oracle-builder.ts      신탁 데이터 구축
│   │   └── types/
│   │       └── comment.types.ts
│   │
│   ├── power-system/                  ⚡ 유튜버 파워 시스템
│   │   ├── README.md
│   │   ├── routes/
│   │   │   └── power-routes.ts        /api/power/* 라우트
│   │   ├── services/
│   │   │   ├── subscriber-power.ts    구독자 수 → 마력 계산
│   │   │   ├── like-mana.ts           좋아요 → 마나 계산
│   │   │   ├── npc-popularity.ts      NPC 인기도 추적
│   │   │   └── buff-debuff.ts         댓글 기반 버프/디버프
│   │   └── types/
│   │       └── power.types.ts
│   │
│   ├── npc-world/                     🌍 NPC 살아있는 세계
│   │   ├── README.md
│   │   ├── routes/
│   │   │   └── npc-routes.ts          /api/npcs/* 라우트
│   │   ├── services/
│   │   │   ├── npc-manager.ts         NPC CRUD + 프로필 관리
│   │   │   ├── world-clock.ts         세계 시간 계산 (업로드 간격 기반)
│   │   │   └── encounter-checker.ts   조우 확률 계산
│   │   └── types/
│   │       └── npc.types.ts
│   │
│   ├── references/                    📦 레퍼런스 자동 수집
│   │   ├── README.md
│   │   ├── services/
│   │   │   ├── image-collector.ts     이미지 레퍼런스 수집
│   │   │   ├── voice-collector.ts     음성 레퍼런스 수집
│   │   │   ├── prompt-collector.ts    프롬프트 레퍼런스 수집
│   │   │   ├── external-collector.ts  외부 CC0 소스 수집
│   │   │   └── style-gatekeeper.ts    스타일 일관성 필터
│   │   └── types/
│   │       └── reference.types.ts
│   │
│   ├── comfyui/                       🖥️ ComfyUI 연동
│   │   ├── README.md
│   │   ├── client.ts                  WebSocket 클라이언트
│   │   ├── workflow-builder.ts        워크플로우 JSON 동적 생성
│   │   ├── queue-manager.ts           생성 큐 + 상태 추적
│   │   ├── workflows/                 워크플로우 정의 모듈
│   │   │   ├── kontext-workflows.ts   FLUX.1 Kontext 앵커/편집 워크플로우
│   │   │   ├── lora-workflows.ts      FluxTrainer 학습 + LoRA 추론 워크플로우
│   │   │   └── caption-workflows.ts   Florence-2 캡셔닝 워크플로우
│   │   └── types/
│   │       └── comfyui.types.ts       ComfyUI API 타입
│   │
│   ├── python-api/                    🤖 Python FastAPI 호출 (HTTP)
│   │   ├── README.md
│   │   ├── api-client.ts             공통 HTTP 클라이언트 (→ :8000)
│   │   ├── types/
│   │   │   └── api-response.types.ts  Python API 응답 타입
│   │   └── endpoints/
│   │       ├── script-api.ts          대본 생성 요청/응답
│   │       ├── embedding-api.ts       임베딩 요청/응답
│   │       ├── tts-api.ts             TTS 요청/응답
│   │       ├── analysis-api.ts        댓글 분석 요청/응답
│   │       └── quality-api.ts         품질 판정 요청/응답
│   │
│   ├── queue/                         📋 BullMQ 작업 큐
│   │   ├── README.md
│   │   ├── bull-config.ts             Redis 연결 + 큐 설정
│   │   ├── workers/
│   │   │   ├── image-gen-worker.ts    이미지 생성 워커
│   │   │   ├── video-gen-worker.ts    영상 생성 워커
│   │   │   ├── tts-worker.ts          TTS 생성 워커
│   │   │   ├── postprocess-worker.ts  후처리 워커
│   │   │   └── upload-worker.ts       YouTube 업로드 워커
│   │   └── types/
│   │       └── job.types.ts           작업 정의 타입
│   │
│   └── web/                           🌐 관리 웹 UI
│       ├── README.md
│       ├── public/
│       │   ├── css/
│       │   │   └── styles.css         Tailwind 빌드 결과
│       │   ├── js/
│       │   │   ├── characters.js      캐릭터 선택 UI 로직
│       │   │   ├── lora.js            LoRA 데이터셋/학습 UI 인터랙션
│       │   │   ├── episodes.js        대본 검수 UI 로직
│       │   │   ├── dashboard.js       대시보드 로직
│       │   │   └── common.js          공통 유틸 (fetch 래퍼 등)
│       │   └── images/
│       ├── views/
│       │   ├── layouts/
│       │   │   └── main.html          공통 레이아웃 (사이드바)
│       │   ├── dashboard.html         메인 대시보드
│       │   ├── characters/
│       │   │   ├── candidates.html    후보 그리드
│       │   │   ├── derivatives.html   파생 이미지 검수
│       │   │   ├── lora-dataset.ejs   데이터셋 + 캡션 관리 UI
│       │   │   ├── lora-training.ejs  학습 모니터 + 체크포인트 평가 UI
│       │   │   └── manage.html        캐릭터 관리
│       │   ├── episodes/
│       │   │   ├── script-editor.html 대본 에디터
│       │   │   ├── scene-preview.html 씬 미리보기
│       │   │   └── list.html          에피소드 목록
│       │   ├── comments/
│       │   │   └── analysis.html      댓글 분석 대시보드
│       │   └── queue/
│       │       └── monitor.html       생성 큐 모니터링
│       └── routes/
│           └── web-routes.ts          HTML 페이지 라우트
│
├── tests/                             🧪 테스트
│   ├── unit/
│   │   ├── characters/
│   │   ├── episodes/
│   │   └── comfyui/
│   └── integration/
│       ├── oracle-connection.test.ts
│       └── comfyui-connection.test.ts
│
├── scripts/                           📜 유틸 스크립트
│   ├── init-oracle.ts                 Oracle 스키마 초기화
│   ├── seed-data.ts                   초기 데이터 투입
│   └── test-comfyui.ts               ComfyUI 연결 테스트
│
└── exports/                           📤 완성 영상 출력
    ├── ep01/
    ├── ep02/
    └── ...

C:\VideoFactory\ai-services\          🐍 Python FastAPI (AI/LLM 전담)
│
├── README.md
├── requirements.txt
├── main.py                            FastAPI 앱 진입점
├── config.py                          환경 변수 + 설정
│
├── routers/                           API 라우터
│   ├── script_router.py               /api/script/* (대본 생성)
│   ├── embedding_router.py            /api/embedding/* (임베딩 생성)
│   ├── tts_router.py                  /api/tts/* (음성 생성)
│   ├── analysis_router.py             /api/analysis/* (댓글/감정 분석)
│   ├── quality_router.py              /api/quality/* (이미지 품질 판정)
│   ├── npc_router.py                  /api/npc/* (NPC 시뮬레이션)
│   └── health_router.py               /api/health (상태 확인)
│
├── services/                          비즈니스 로직
│   ├── claude/                        🧠 Claude 연동
│   │   ├── shorunner.py               쇼러너 (대본 생성 메인)
│   │   ├── context_assembler.py       Oracle 6가지 컨텍스트 수집
│   │   ├── prompt_templates.py        시스템/유저 프롬프트 템플릿
│   │   └── script_validator.py        대본 JSON 검증
│   │
│   ├── embedding/                     🔢 임베딩 생성
│   │   ├── clip_embedder.py           CLIP ViT-H (이미지+텍스트, 512d)
│   │   ├── minilm_embedder.py         MiniLM (댓글 텍스트, 384d)
│   │   ├── wav2vec_embedder.py        wav2vec2 (음성, 256d)
│   │   └── batch_embedder.py          배치 임베딩 처리
│   │
│   ├── tts/                           🔊 음성 생성
│   │   ├── qwen_tts.py                Qwen3-TTS 래핑
│   │   ├── voice_profiles.py          캐릭터별 음성 설정
│   │   └── audio_processor.py         음성 후처리 (노이즈, 떨림)
│   │
│   ├── analysis/                      📊 분석
│   │   ├── comment_analyzer.py        댓글 클러스터링
│   │   ├── sentiment_scorer.py        감정 분석
│   │   ├── npc_popularity.py          NPC 인기도 추적
│   │   └── oracle_builder.py          신탁 데이터 구축
│   │
│   ├── quality/                       ✅ 품질 판정
│   │   ├── image_scorer.py            이미지 품질 (얼굴/블러/CLIP)
│   │   ├── video_scorer.py            영상 품질 (프레임 일관성)
│   │   ├── prompt_optimizer.py        프롬프트 자동 진화
│   │   └── face_detector.py           얼굴 감지 (InsightFace)
│   │
│   └── whisper/                       📝 자막
│       └── transcriber.py             Whisper STT
│
├── npc/                               🌍 NPC 생활 시뮬레이션
│   ├── life_simulator.py              메인 시뮬레이션 엔진
│   ├── event_generator.py             랜덤 이벤트 발생
│   ├── interaction_engine.py          NPC 간 상호작용 (Claude)
│   ├── event_chainer.py               이벤트 체이닝 (Claude)
│   └── encounter_builder.py           조우 컨텍스트 생성
│
├── db/                                Oracle 26ai 연결 (Python)
│   ├── oracle_connection.py           python-oracledb 연결 풀
│   ├── vector_search.py               Vector 유사도 검색
│   ├── graph_queries.py               GRAPH_TABLE 쿼리
│   └── context_queries.py             컨텍스트 수집용 통합 쿼리
│
├── models/                            Pydantic 모델
│   ├── script_models.py               대본 요청/응답
│   ├── embedding_models.py            임베딩 요청/응답
│   ├── analysis_models.py             분석 요청/응답
│   └── quality_models.py              품질 요청/응답
│
└── tests/
    ├── test_claude.py
    ├── test_embedding.py
    └── test_tts.py
```

---

## 모듈 간 의존성 맵

```
=== Node.js (오케스트레이션) ===

characters ──→ comfyui (이미지 생성: Kontext 앵커/편집)
           ──→ comfyui/workflows (Kontext, LoRA, Caption 워크플로우)
           ──→ db (Oracle CRUD + LoRA 5개 테이블)
           ──→ python-api → [Python] embedding (CLIP 임베딩)
           ──→ python-api → [Python] quality (품질 스코어링)

lora       ──→ comfyui/workflows (FluxTrainer 학습, Florence-2 캡셔닝)
           ──→ db/lora-queries (데이터셋, 학습 잡, 체크포인트, 평가)
           ──→ characters (앵커/파생 이미지 → 데이터셋 소스)

episodes   ──→ db (에피소드 CRUD)
           ──→ python-api → [Python] script (대본 생성 전체)
           ──→ python-api → [Python] analysis (시청자 여론)

video      ──→ comfyui (Flux + Wan)
           ──→ db (씬 로드)
           ──→ python-api → [Python] tts (음성 생성)
           ──→ python-api → [Python] quality (영상 품질 판정)

postprocess ──→ video (영상 입력)
            ──→ db (댓글 오버레이 데이터)

comments   ──→ db (댓글 저장)
           ──→ python-api → [Python] analysis (클러스터링, 감정)
           ──→ python-api → [Python] embedding (댓글 임베딩)

power-system ──→ db (구독자 수, NPC 인기도)

references ──→ db (CRUD)
           ──→ python-api → [Python] embedding (임베딩 생성)

모든 Node.js 모듈 ──→ common (로깅, 에러, 유틸)
                  ──→ config (환경 설정)

=== Python FastAPI (AI/LLM 전담) ===

script     ──→ claude (Claude API 호출)
           ──→ db (Oracle 컨텍스트 수집 — Vector + Graph)
           ──→ analysis (시청자 여론 참조)

embedding  ──→ CLIP / MiniLM / wav2vec2 (모델 로드)

analysis   ──→ embedding (댓글 임베딩)
           ──→ db (Oracle Vector 클러스터)

quality    ──→ embedding (CLIP 유사도)
           ──→ face_detector (InsightFace)

tts        ──→ Qwen3-TTS (음성 생성)
           ──→ db (캐릭터 voice_config 로드)

=== 핵심 원칙 ===
Node.js → Python: HTTP REST (:8000)
Python → Oracle: python-oracledb (Vector/Graph/JSON 검색)
Node.js → Oracle: oracledb npm (일반 CRUD)
Node.js → ComfyUI: WebSocket (:8188)
```

---

## Oracle 26ai 테이블 요약

> 모든 이미지 테이블은 image_path(파일) + image_blob(BLOB) + thumbnail_blob(256px) 이중 저장.
> 파일시스템은 ComfyUI/FFmpeg 작업용, BLOB은 백업/검색/이식용.

| 테이블 | 모델 | 핵심 필드 |
|--------|------|----------|
| characters | Rel+JSON+BLOB | name, profile(JSON), mood(JSON), face_embedding(Vec), anchor_blob(BLOB) |
| char_candidates | Rel+Vec+BLOB | char_id, image_blob(BLOB), thumbnail_blob(BLOB), score, grade, liked |
| char_ref_images | Rel+Vec+BLOB | char_id, image_blob(BLOB), pose_tag, image_embedding(Vec) |
| locations | Rel+JSON | location_id, name, prompt_base, prompt_variants(JSON) |
| location_ref_images | Rel+Vec+BLOB | location_id, image_blob(BLOB), time_of_day, weather, angle, embedding(Vec) |
| item_ref_images | Rel+Vec+BLOB | item_id, image_blob(BLOB), state, angle, embedding(Vec) |
| episodes | Rel+JSON | title, synopsis, script_json(CLOB), world_state(JSON) |
| scenes | Rel+JSON+BLOB | ep_id, location_id(FK), prompt_en, keyframe_blob(BLOB), status |
| youtube_comments | Rel+Vec | ep_id, author, text, likes, cluster_id, embedding(Vector) |
| char_relationships | Graph | from_id, to_id, rel_type, trust |
| viewer_sentiments | Graph | char_id, ep_id, positive, negative, requests(JSON) |
| running_gags | Rel | description, last_used_ep, usage_count, active |
| prompt_references | Rel+Vec | prompt_text, quality_score, embedding(Vector) |
| voice_references | Rel+Vec | char_id, emotion_tag, tts_config(JSON), embedding(Vector) |
| external_references | Rel+Vec | type, source_url, license, embedding(Vector) |
| lora_training_log | Rel | char_id, steps, rank, loss, model_path |
| wall_break_log | Rel | ep_id, level, description |
| npcs | Rel+JSON | npc_id, name, role, importance, profile(JSON), mood(JSON), location |
| npc_events | Rel+JSON | npc_id, event_type, description, effects(JSON), world_time |
| npc_event_pool | Rel+JSON | name, category, probability, trigger_conditions(JSON) |
| npc_location_log | Rel | npc_id, location, activity, world_time |
| items | Rel+JSON | item_id, name, type, rarity, visual(JSON), stats(JSON) |
| character_inventory | Rel | owner_id, item_id, status, slot, durability |
| item_ref_images | Rel+Vec | item_id, image_path, embedding(Vector), state, angle, is_anchor |
| item_history | Rel | item_id, owner_id, event_type, ep_id |
| monsters | Rel+JSON | monster_id, name, grade, visual(JSON), stats(JSON), drops(JSON) |
| regions | Rel+JSON | region_id, name, type, danger_rank, visual(JSON), connections(JSON) |
| dungeons | Rel+JSON | dungeon_id, name, region_id, boss_id, status |
| power_history | Rel | char_id, ep_id, subscriber_count, power_level, stats |
| content_formats | Rel+JSON | format_id, category, frequency, comedy_hooks(JSON) |
| fantasy_foods | Rel+JSON | food_id, name, taste_profile(JSON), visual(JSON), rating |
| enhancement_log | Rel+JSON | item_id, from/to_level, success, destroyed, audience_vote |

---

## API 엔드포인트 요약

### 캐릭터 (/api/characters)
```
POST   /generate-candidates     후보 배치 생성
GET    /candidates/:jobId        후보 목록 조회
POST   /candidates/:jobId/like   좋아요 토글
POST   /candidates/:jobId/more   추가 생성
POST   /candidates/:jobId/anchor 앵커 확정
GET    /derivatives/:charId      파생 이미지 목록
POST   /derivatives/:charId/approve 파생 검수 → DB 등록
GET    /                          캐릭터 목록
GET    /:charId                   캐릭터 상세
```

### LoRA (/api/lora)
```
POST   /datasets                    데이터셋 생성
GET    /datasets/:charId            데이터셋 조회
POST   /datasets/:datasetId/images  이미지 추가
DELETE /datasets/:datasetId/images/:imageId  이미지 삭제
POST   /datasets/:datasetId/caption 자동 캡셔닝 (Florence-2)
PUT    /datasets/:datasetId/images/:imageId/caption  캡션 수정
POST   /training/start              학습 시작
GET    /training/:jobId/status      학습 상태 조회
POST   /training/:jobId/cancel      학습 취소
GET    /training/:jobId/checkpoints 체크포인트 목록
POST   /training/evaluate           체크포인트 추론 테스트
POST   /training/:jobId/checkpoints/:step/select  체크포인트 확정
```

### 에피소드 (/api/episodes)
```
POST   /generate                  대본 생성
GET    /:epId/draft               초안 조회
PUT    /:epId/scenes/:id          씬 수정
POST   /:epId/scenes/:id/regen    씬 재생성
POST   /:epId/approve             승인 → 큐 등록
DELETE /:epId/draft               폐기
```

### 영상 (/api/video)
```
POST   /episodes/:epId/generate   영상 생성 시작
GET    /episodes/:epId/status     진행 상황
POST   /scenes/:sceneId/regen     씬 재생성
WS     /ws/generation/:epId       실시간 스트리밍
```

### 댓글 (/api/comments)
```
POST   /fetch                     YouTube 댓글 수집
GET    /analysis/:epId            분석 결과
```

### 파워 시스템 (/api/power)
```
GET    /status                    전체 파워 현황
GET    /npc-popularity            NPC 인기도 차트
```

### 큐 (/api/queue)
```
GET    /status                    큐 상태
WS     /ws/queue                  실시간 큐 모니터링
```

### NPC 월드 (/api/npcs — Node.js, /api/npc — Python)
```
Node.js:
GET    /api/npcs                  NPC 목록 (위치, 상태)
GET    /api/npcs/:id              NPC 상세
GET    /api/npcs/map              위치별 NPC 현황
GET    /api/npcs/events           오프스크린 이벤트 로그

Python:
POST   /api/npc/simulate          전체 NPC 시뮬레이션 (n일)
POST   /api/npc/:id/simulate      특정 NPC 시뮬레이션
GET    /api/npc/encounters        조우 가능 NPC 목록
POST   /api/npc/interact          NPC 간 상호작용 생성
```

---

## ComfyUI 커스텀 노드 (필수 설치)

> LoRA 파이프라인 운영에 필요한 ComfyUI 커스텀 노드 목록.
> ComfyUI Manager에서 설치하거나, custom_nodes/ 디렉토리에 직접 클론.

| 노드 | 용도 | 비고 |
|------|------|------|
| ComfyUI-KontextWrapper | FLUX.1 Kontext 앵커/편집 | 캐릭터 후보 생성 + 파생 이미지 |
| ComfyUI-FluxTrainer | LoRA 학습 (FluxTrainer) | 데이터셋 → LoRA 모델 산출 |
| ComfyUI-Florence2 | Florence-2 자동 캡셔닝 | LoRA 데이터셋 캡션 생성 |
| ComfyUI-GGUF | GGUF 양자화 모델 로드 | FLUX GGUF 지원 |
| ComfyUI-ADetailer | 얼굴/손 자동 보정 | 후처리 디테일 업 |
| ComfyUI-Advanced-ControlNet | 고급 ControlNet | 포즈/깊이 제어 |
| comfyui_controlnet_aux | ControlNet 전처리기 | OpenPose, Depth 등 |

> **참고**: `src/gemini/` 모듈은 삭제됨 (Gemini API 직접 호출 → ComfyUI Kontext 워크플로우로 대체).
> 이미지 생성/편집은 전부 ComfyUI WebSocket 경유로 통일.

---

## 변경 이력

| 날짜 | 변경 | 담당 |
|------|------|------|
| 2026-03-27 | 초기 아키텍처 설계 | Claude.ai 브레인스토밍 |
| 2026-03-27 | Python LLM 전담 분리 | 역할 분리 원칙 추가 |
| 2026-03-27 | NPC 살아있는 세계 시스템 추가 | 07번 설계 문서 |
| 2026-03-27 | 세계관 시스템 (장비/몬스터/월드맵) 추가 | 08번 설계 문서, Oracle 8개 테이블 추가 |
| 2026-03-27 | 유튜브 컨텐츠 포맷 (먹방/강화쇼/언박싱) 추가 | 09번 설계 문서, Oracle 3개 테이블 추가 |
| 2026-03-27 | 아이템 비주얼 일관성 3 Tier 전략 추가 | 08번 문서 업데이트, item_ref_images 테이블 |
| 2026-03-27 | BLOB 이중 저장 + 장소 비주얼 일관성 추가 | 전 테이블 BLOB 컬럼, locations + location_ref_images 테이블 |
| 2026-03-28 | Gemini 제거 + ComfyUI Kontext 전환 | src/gemini/ 삭제, Kontext 워크플로우로 대체 |
| 2026-03-28 | LoRA 파이프라인 추가 | 데이터셋, 캡셔닝, 학습, 추론, 평가 전체 구현 |
| 2026-03-28 | ComfyUI workflows/ 모듈 신설 | kontext, lora, caption 워크플로우 분리 |
| 2026-03-28 | LoRA REST API (12 엔드포인트) | lora-routes.ts, lora-queries.ts 추가 |
| 2026-03-28 | LoRA 웹 UI 추가 | 데이터셋 관리 + 학습 모니터 페이지 |
| | 다음 변경 시 여기에 추가 | |
