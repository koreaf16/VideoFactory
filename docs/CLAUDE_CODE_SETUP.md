# Claude Code 초기 설정 가이드

> Claude Code에서 이 프로젝트를 처음 시작할 때 사용하는 가이드
> 2026-03-27

---

## 1단계: 프로젝트 시작

Claude Code 터미널에서:

```bash
cd C:\VideoFactory
```

첫 번째 지시:

```
이 프로젝트는 AI 영상 공장이야. 
다음 파일들을 순서대로 읽어줘:
1. CLAUDE.md (프로젝트 규칙)
2. ARCHITECTURE.md (전체 아키텍처)
3. docs/design/10_Phase1_구현_설계도.md (구현 순서)

읽고 나서 Step 0부터 시작하자.
```

---

## 2단계: Claude Code에 전달할 초기화 명령

```
프로젝트를 ARCHITECTURE.md의 디렉토리 구조대로 초기화해줘.
Node.js와 Python 두 프로젝트를 모두 만들어야 해.

★ 핵심 규칙: LLM/AI와 닿는 모든 코드는 Python에서 작성.
Node.js는 오케스트레이션+웹UI만.

=== Node.js (C:\VideoFactory\) ===
1. package.json 생성 (name: ai-video-factory)
2. tsconfig.json 생성 (strict: true)
3. .env.example 생성
4. .gitignore 생성
5. ARCHITECTURE.md의 Node.js 디렉토리 구조 생성
6. 각 도메인 디렉토리에 README.md 생성
7. npm install (의존성 설치)
8. src/config.ts 작성 (환경 변수 로드)
9. src/common/ 공통 모듈 작성 (logger, errors, middleware)
10. src/app.ts + src/server.ts 기본 뼈대
11. src/python-api/api-client.ts — Python FastAPI 호출 공통 클라이언트

=== Python (C:\VideoFactory\ai-services\) ===
1. requirements.txt 생성
2. config.py 생성 (환경 변수)
3. main.py FastAPI 앱 뼈대
4. routers/ 디렉토리 + health_router.py
5. services/ 전체 디렉토리 구조 생성
6. db/ Oracle 연결 뼈대
7. models/ Pydantic 모델 뼈대
8. 각 디렉토리에 README.md

CLAUDE.md의 규칙을 반드시 따라:
- 모든 .ts/.py 파일 상단에 모듈 설명 블록 + 구조도
- 파일 200줄 이하
- Node.js: any 타입 금지, 인라인 SQL 금지
- Python: 타입 힌트 필수, Pydantic 모델 필수
- Node.js에서 LLM/AI 직접 호출 절대 금지
```

---

## 3단계: 연결 테스트 명령

프로젝트 뼈대가 잡히면:

```
두 가지 연결 테스트를 해줘.

=== 테스트 1: ComfyUI 연결 ===
1. src/comfyui/client.ts 작성
   - WebSocket으로 127.0.0.1:8188 연결
   - 시스템 정보 조회 (GET /system_stats)
   - 연결 상태 관리 (연결/끊김/재연결)

2. scripts/test-comfyui.ts 작성
   - 연결 테스트 실행 스크립트

=== 테스트 2: Python FastAPI 연결 ===
1. ai-services/main.py 완성 (health 엔드포인트)
2. ai-services/routers/health_router.py 작성
   - GET /api/health → { status: "ok", services: [...] }
3. src/python-api/api-client.ts 작성
   - http://localhost:8000 연결 + 상태 확인

4. scripts/test-connections.ts 작성
   - ComfyUI + Python + Oracle 전부 테스트

파일 작성 후 ARCHITECTURE.md 변경 이력에 기록해줘.
```

---

## 4단계: 캐릭터 생성 파이프라인 구현 명령

연결 테스트 성공 후:

```
캐릭터 후보 생성 파이프라인을 구현해줘.
docs/design/03_캐릭터_생성_파이프라인.md 를 참고해.

★ 기억: 품질 스코어링, 임베딩은 Python에서 처리!

=== Node.js 파트 ===
1. src/characters/templates/ — 프롬프트 템플릿 (Layer 1,2,3)
2. src/characters/services/prompt-builder.ts — 프롬프트 변형 50개 자동 생성
3. src/comfyui/workflow-builder.ts — Flux 2 Klein 9B 워크플로우 JSON 생성
4. src/characters/services/candidate-generator.ts — 배치 생성 + 결과 수집
5. src/characters/routes/character-routes.ts — POST /api/characters/generate-candidates
6. src/python-api/endpoints/quality-api.ts — Python 품질 판정 API 호출
7. src/python-api/endpoints/embedding-api.ts — Python 임베딩 API 호출
8. src/web/views/characters/candidates.html — 후보 그리드 UI
9. src/web/public/js/characters.js — 좋아요/확정 UI 로직

=== Python 파트 ===
10. ai-services/routers/quality_router.py — POST /api/quality/score-image
11. ai-services/services/quality/image_scorer.py — CLIP 유사도 + 얼굴 감지
12. ai-services/services/quality/face_detector.py — InsightFace 래핑
13. ai-services/routers/embedding_router.py — POST /api/embedding/image
14. ai-services/services/embedding/clip_embedder.py — CLIP ViT-H 512d

각 파일 작성 후:
- 파일 상단에 모듈 구조도 주석 추가
- ARCHITECTURE.md 업데이트
- 해당 도메인 README.md 업데이트
```

---

## 주의사항 (Claude Code에게)

이 프로젝트는 **CLAUDE.md의 규칙을 엄격히 따르는** 프로젝트입니다.

매 작업마다:
- [ ] 파일 상단 모듈 설명 블록 있는지 확인
- [ ] 파일 200줄 이하인지 확인
- [ ] any 타입 없는지 확인
- [ ] 인라인 SQL 없는지 확인
- [ ] ARCHITECTURE.md 업데이트 필요한지 확인
- [ ] README.md 업데이트 필요한지 확인
- [ ] .env.example 업데이트 필요한지 확인
