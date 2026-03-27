# CLAUDE.md — AI 영상 공장 프로젝트 규칙

> 이 파일은 Claude Code가 프로젝트에 진입할 때 **반드시 먼저 읽는** 마스터 지침서입니다.
> 모든 작업 전에 이 파일과 ARCHITECTURE.md를 참조하세요.

---

## 프로젝트 개요

**이세계 유튜버 한소율** — AI 영상 시리즈 자동 제작 시스템
- 고등학생 유튜버가 이세계에서 모험하는 코미디/판타지
- 시청자 댓글 = 신탁, 구독자 수 = 주인공 마력
- RTX 3090 24GB + ComfyUI + Oracle 26ai

---

## 핵심 규칙

### 1. 문서 우선 (Documentation First)

**작업 전**:
- `ARCHITECTURE.md` 읽고 현재 구조 파악
- 해당 모듈의 `README.md` 확인

**작업 후**:
- 구조 변경 시 → `ARCHITECTURE.md` 즉시 업데이트
- 새 모듈 추가 시 → 해당 디렉토리에 `README.md` 생성
- API 변경 시 → `docs/api/` 해당 엔드포인트 문서 업데이트
- 설정 변경 시 → `docs/setup/` 해당 가이드 업데이트

### 2. 소스 파일 규칙

**파일 상단 주석 필수**:
모든 .ts 파일 최상단에 아래 형식의 모듈 설명 블록을 넣는다.

```typescript
/**
 * @module 캐릭터 후보 생성 서비스
 * @description ComfyUI API를 통해 캐릭터 후보 이미지를 배치 생성한다.
 *
 * ┌─────────────┐     ┌──────────┐     ┌──────────┐
 * │ PromptBuilder│ ──→ │ ComfyUI  │ ──→ │ Quality  │
 * │  (프롬프트)   │     │ Client   │     │ Scorer   │
 * └─────────────┘     └──────────┘     └──────────┘
 *        ↑                                   ↓
 *   Oracle DB                          Oracle DB
 *  (캐릭터 프로필)                    (후보 이미지 저장)
 *
 * @dependencies comfyui-client, prompt-builder, quality-scorer, oracle
 * @author AI Video Factory
 */
```

**파일 크기 제한**:
- 단일 파일 **200줄 이하** 권장, **300줄 초과 금지**
- 초과 시 반드시 분리 (헬퍼, 유틸, 타입으로)

**함수 크기 제한**:
- 단일 함수 **50줄 이하** 권장
- 초과 시 서브 함수로 분리

### 3. 디렉토리 구조 규칙

**깊이 있는 분리 원칙**:
```
기능 도메인 / 레이어 / 구체적 파일
```

예시:
```
src/
  characters/           ← 기능 도메인
    services/           ← 레이어
      candidate-gen.ts  ← 구체적 기능
      anchor-select.ts
      derivative-gen.ts
    routes/
      characters.ts
    types/
      character.types.ts
```

**새 기능 추가 시**:
1. 해당 도메인 디렉토리 생성
2. services/, routes/, types/ 하위 구조 생성
3. README.md 작성
4. ARCHITECTURE.md의 디렉토리 트리 업데이트

### 4. Oracle 26ai 규칙

**쿼리 파일 분리**:
- 인라인 SQL 금지
- 모든 쿼리는 `src/db/queries/` 하위에 도메인별 파일로 분리
- 예: `src/db/queries/character-queries.ts`

**4개 데이터 모델 명시**:
- Vector 쿼리 → `vector-` 접두어
- Graph 쿼리 → `graph-` 접두어
- JSON 쿼리 → `json-` 접두어
- 일반 Relational → 접두어 없음

**BLOB 저장 규칙**:
- 모든 이미지는 **파일 경로 + BLOB 이중 저장**
- `image_path`: 파일시스템 경로 (ComfyUI/FFmpeg 작업용)
- `image_blob`: Oracle BLOB (백업/검색/이식용)
- `thumbnail_blob`: 256px 리사이즈 JPEG (웹 UI 그리드용)
- 이미지 저장 시 반드시 `saveImageWithBlob()` 헬퍼 사용
- BLOB에서 파일 복원 시 `restoreImageFromBlob()` 헬퍼 사용

**비주얼 일관성 규칙**:
- 캐릭터, 아이템, 장소 모두 **동일한 3 Tier 전략** 적용
- Tier 1 (프롬프트만) / Tier 2 (레퍼런스 이미지) / Tier 3 (LoRA)
- 씬 생성 시 IP-Adapter 참조 = 캐릭터 ref + 장소 ref (+ 아이템 ref)
- 레퍼런스 이미지 선택은 CLIP 임베딩 유사도 기반 자동 매칭

### 5. 타입 안전성

**TypeScript strict 모드**:
- `any` 타입 금지 (불가피한 경우 주석으로 이유 명시)
- 모든 API 요청/응답에 인터페이스 정의
- 타입은 해당 도메인의 `types/` 디렉토리에

### 6. 에러 처리

- 모든 async 함수에 try-catch
- 커스텀 에러 클래스 사용 (`src/common/errors/`)
- 에러 로깅은 `src/common/logger.ts` 통해서

### 7. 환경 변수

- `.env.example` 항상 최신 유지
- 새 환경 변수 추가 시 `.env.example`에도 추가
- 비밀 값은 절대 하드코딩 금지

### 8. Git 커밋 규칙

```
feat: 캐릭터 후보 생성 API 추가
fix: ComfyUI 연결 타임아웃 수정
docs: ARCHITECTURE.md 디렉토리 구조 업데이트
refactor: 프롬프트 빌더 모듈 분리
chore: 의존성 업데이트
```

---

## 작업 흐름 (매번 따라야 함)

```
1. ARCHITECTURE.md 읽기
2. 관련 모듈 README.md 읽기
3. 코드 작성/수정
4. 파일 상단 주석 확인/업데이트
5. ARCHITECTURE.md 업데이트 (구조 변경 시)
6. README.md 업데이트 (모듈 변경 시)
7. .env.example 업데이트 (환경 변수 변경 시)
```

---

## 기술 스택

| 구성 | 기술 | 비고 |
|------|------|------|
| 런타임 | Node.js 20+ | TypeScript strict |
| 웹 서버 | Express 4.x | REST API + 정적 파일 |
| DB (Node) | Oracle 26ai | oracledb 6.x — **일반 CRUD만** |
| DB (Python) | Oracle 26ai | python-oracledb — **Vector/Graph/컨텍스트** |
| 큐 | BullMQ | Redis 기반 |
| GPU | ComfyUI | WebSocket API (:8188) |
| **AI 전담** | **Python FastAPI** | **Claude, TTS, 임베딩, 분석, 품질 (:8000)** |
| 후처리 | FFmpeg | fluent-ffmpeg |
| 이미지 | sharp | 리사이즈, 썸네일 |
| 프론트 | HTML + Tailwind + Alpine.js | SPA 아님, MPA |

---

## Node.js ↔ Python 역할 분리 (매우 중요)

### ★ 절대 규칙: LLM/AI 모델과 닿는 모든 코드는 Python에서 작성

| Node.js (TypeScript) | Python (FastAPI) |
|----------------------|------------------|
| ComfyUI WebSocket 제어 | ❌ |
| FFmpeg 후처리 | ❌ |
| BullMQ 작업 큐 | ❌ |
| Express 웹 서버 + UI | ❌ |
| YouTube API | ❌ |
| Oracle 일반 CRUD | Oracle Vector/Graph/컨텍스트 검색 |
| ❌ | Claude API 호출 (대본 생성) |
| ❌ | Qwen3-TTS (음성 생성) |
| ❌ | CLIP/MiniLM 임베딩 생성 |
| ❌ | 댓글 클러스터링 + 감정 분석 |
| ❌ | 이미지/영상 품질 스코어링 |
| ❌ | Whisper 자막 생성 |
| ❌ | 프롬프트 최적화 |

### Node.js에서 Python 호출 방법

```typescript
// Node.js → Python FastAPI (HTTP)
const response = await fetch('http://localhost:8000/api/script/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ep_id: 3, context: {...} })
});
const script = await response.json();
```

### 금지: Node.js에서 직접 AI 호출

```typescript
// ❌ 절대 금지 — Node.js에서 Claude 직접 호출
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

// ❌ 절대 금지 — Node.js에서 임베딩 직접 생성
import { pipeline } from '@xenova/transformers';

// ✅ 올바른 방법 — Python API 호출
const result = await pythonApi.post('/api/embedding/image', { image_path });
```

---

## 외부 서비스 연결

| 서비스 | 호스트 | 포트 | 프로토콜 |
|--------|--------|------|----------|
| ComfyUI | 127.0.0.1 | 8188 | WebSocket |
| Python FastAPI | 127.0.0.1 | 8000 | REST |
| Oracle 26ai | localhost | 1521 | TCP (TNS) |
| Redis | localhost | 6379 | TCP |
| 관리 웹 UI | 0.0.0.0 | 3000 | HTTP |

---

## 주요 파이프라인 (구현 순서)

| # | 파이프라인 | 상태 | 설계 문서 |
|---|----------|------|----------|
| 1 | 캐릭터 생성 | 🔜 다음 | docs/design/03_캐릭터_생성.md |
| 2 | 대본 생성 | 📋 설계됨 | docs/design/04_대본_생성.md |
| 3 | 영상 생성 | 📋 설계됨 | docs/design/05_영상_생성.md |
| 4 | 후처리/배포 | 📋 미완 | docs/design/06_후처리_배포.md |

---

## 금지 사항

### Node.js
- `console.log` 직접 사용 금지 → `logger` 사용
- 인라인 SQL 금지 → 쿼리 파일 분리
- `any` 타입 금지
- 단일 파일 300줄 초과 금지
- 하드코딩된 경로/URL 금지 → config.ts 사용
- 문서 업데이트 없는 구조 변경 금지
- **LLM/AI 모델 직접 호출 금지 → 반드시 Python API 경유**
- **임베딩 생성, 감정 분석, CLIP 유사도 등 AI 연산 직접 수행 금지**

### Python
- 파일 상단 docstring 필수 (모듈 설명 + 구조도)
- 단일 파일 300줄 초과 금지
- 타입 힌트 필수 (모든 함수 인자 + 리턴)
- Pydantic 모델로 요청/응답 정의 (dict 직접 반환 금지)
- 인라인 SQL 금지 → db/ 디렉토리 쿼리 분리
- 하드코딩 금지 → config.py 사용
- print() 금지 → logging 모듈 사용

### Python 파일 상단 규칙

```python
"""
@module 댓글 클러스터링 분석기
@description MiniLM 임베딩 기반으로 댓글을 클러스터링하고 감정 분석한다.

┌──────────────┐     ┌──────────┐     ┌──────────┐
│ MiniLM       │ ──→ │ K-Means  │ ──→ │ Oracle   │
│ Embedder     │     │ Cluster  │     │ Vector   │
└──────────────┘     └──────────┘     └──────────┘
      ↑                                    ↓
  youtube_comments                  viewer_sentiments

@dependencies minilm_embedder, oracle_connection
"""
```
