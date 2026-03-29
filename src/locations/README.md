# 장소 관리 모듈 (`src/locations/`)

장소(배경) 관리 + LoRA 학습 파이프라인. 캐릭터 파이프라인과 동일한 패턴.

## 파이프라인 흐름

```
장소 등록 → 배경 후보 생성 (FLUX txt2img, 30장)
→ 앵커 선택 → 앵글 변형 12종 (Kontext 편집)
→ 갤러리 조회/재생성
→ LoRA 데이터셋 생성 + Florence-2 캡셔닝
→ LoRA 학습 (dim=8, steps 1000)
```

## 디렉토리 구조

```
locations/
  routes/
    location-routes.ts              — CRUD + 마운트 허브
    location-candidate-routes.ts    — 후보 생성 시작/SSE/중단
    location-derivative-routes.ts   — 앵글 변형 SSE/갤러리/재생성
    location-lora-routes.ts         — 데이터셋/캡셔닝/학습
  services/
    location-candidate-generator.ts — FLUX txt2img 배경 후보 배치 생성
    location-derivative-generator.ts — Kontext 앵글 변형 12종 생성
    location-presets.ts             — 앵글 변형 프리셋
  types/
    location.types.ts               — 도메인 인터페이스
```

## API 엔드포인트 (`/api/locations`)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/` | 장소 목록 |
| GET | `/:locationId` | 장소 상세 |
| POST | `/` | 장소 등록 |
| POST | `/generate-candidates` | 배경 후보 생성 시작 |
| GET | `/candidates/:jobId` | 후보 조회 (DB) |
| GET | `/candidates/:jobId/stream` | 후보 생성 SSE |
| POST | `/candidates/:jobId/stop` | 후보 생성 중단 |
| POST | `/candidates/:jobId/like` | 좋아요 토글 |
| POST | `/candidates/:jobId/anchor` | 앵커 확정 → 변형 자동 시작 |
| GET | `/derivatives/:jobId/stream` | 변형 생성 SSE |
| POST | `/derivatives/:jobId/stop` | 변형 생성 중단 |
| GET | `/:locationId/ref-images` | 갤러리 API |
| POST | `/ref-images/:refId/regenerate` | 개별 이미지 재생성 |
| POST | `/:locationId/lora/dataset` | 데이터셋 생성 |
| POST | `/:locationId/lora/caption` | 캡셔닝 시작 |
| POST | `/:locationId/lora/train` | LoRA 학습 시작 |

## 장소 분류

| 유형 | 설명 | 처리 |
|------|------|------|
| `main` | 핵심 장소 (매 에피소드 등장) | LoRA 학습 |
| `sub` | 보조 장소 (1~2회 등장) | 배경 고정 합성 (향후) |
| `background` | 배경 (한 번 스쳐지나감) | 프롬프트만 |

## 학습 파라미터 (캐릭터 vs 장소)

| 파라미터 | 캐릭터 | 장소 |
|---------|--------|------|
| network_dim | 16 | 8 |
| max_train_steps | 1500 | 1000 |
| learning_rate | 5e-5 | 1e-4 |
