# ComfyUI (ComfyUI 연동)

ComfyUI와 WebSocket으로 연동하여 이미지/영상 생성 워크플로우를 실행하는 모듈입니다.
워크플로우 JSON 제출, 진행 상태 추적, 결과 이미지/영상 수신을 처리합니다.

## 구조
- `client/` — WebSocket 클라이언트 및 연결 관리
- `workflows/` — 워크플로우 JSON 템플릿 및 파라미터 바인딩
- `results/` — 생성 결과 수신 및 파일 저장
