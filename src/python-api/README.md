# Python API (Python FastAPI 클라이언트)

Python FastAPI 서버와 통신하는 HTTP 클라이언트 모듈입니다.
AI/LLM 서비스 호출, 임베딩 요청, TTS 요청 등을 Node.js에서 처리합니다.

## 구조
- `client/` — Axios 기반 HTTP 클라이언트 및 재시도 로직
- `endpoints/` — 엔드포인트별 요청/응답 타입 정의
- `interceptors/` — 요청/응답 인터셉터 (로깅, 에러 변환)
