# AI Services (AI/LLM 전담 서버)

Python FastAPI 기반 AI 및 LLM 전담 서버입니다.
Claude API, 임베딩, TTS, 품질 평가, 감정 분석, Whisper 등 AI 서비스를 REST API로 제공합니다.

## 구조
- `routers/` — FastAPI 라우터 (엔드포인트 정의)
- `services/` — AI 서비스 로직 (claude, embedding, tts, quality, analysis, whisper)
- `npc/` — NPC 세계 시뮬레이션 AI 로직
- `db/` — Python 측 DB 연동
- `models/` — Pydantic 모델 (요청/응답 스키마)
- `tests/` — 테스트 코드
