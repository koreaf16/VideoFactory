# 장소 관리 — 하이브리드 고일관성 파이프라인 설계

## 개요

기존 img2img(denoise 0.65) 장소 파이프라인을 **블렌더 3D 뼈대 + ComfyUI ControlNet** 하이브리드로 대체한다.
공간의 구조(벽, 가구, 카메라 투시)는 블렌더 Depth/Normal Map으로 100% 고정하고, 텍스처/분위기는 ComfyUI가 채운다.

### 왜 대체하는가

- AI 이미지 생성은 매번 노이즈에서 새로 그리므로 동일 프롬프트여도 공간 구조가 달라짐
- img2img denoise 0.65는 구조를 "대략" 유지하지만 벽 위치, 창문 개수가 미세하게 변함
- 블렌더 Depth Map은 "정답 투시도"이므로 AI가 상상할 여지가 없음
- 영상 컷 전환 시 투시 붕괴(벽 위치, 창문 개수 변경)를 원천 차단

### 대상

- `location_type = 'main'` 장소만 블렌더 파이프라인 적용
- 기존 데이터 전체 리셋, 신규 파이프라인으로 재생성

## 전체 흐름: 2-Phase 파이프라인

```
┌─────────────── Phase 1: 뼈대 준비 (로컬) ────────────────┐
│                                                           │
│  웹 UI: 장소 설명 입력 (치수, 가구 배치)                     │
│    → Python FastAPI: Claude CLI subprocess 호출            │
│      → bpy 스크립트 생성 (3D 배치 + 카메라 12~15개)         │
│    → Node.js: Blender CLI headless 실행                   │
│      → depth_maps/*.png + normal_maps/*.png 출력          │
│    → 웹 UI: depth map 썸네일 그리드 미리보기                 │
│                                                           │
└───────────────────────────────────────────────────────────┘
                        ↓ 사용자 확인
┌─────────────── Phase 2: 살 입히기 (원격 ComfyUI) ─────────┐
│                                                           │
│  Step 1: 앵커 후보 생성                                    │
│    → cam01 depth/normal + ControlNet으로 후보 4~8장        │
│    → 시드 가챠 → 스타일 앵커 1장 선택                        │
│                                                           │
│  Step 2: 전체 앵글 일괄 생성                                │
│    → 각 카메라 depth/normal + ControlNet                   │
│    → + IP-Adapter(스타일 앵커) + 장소 프롬프트               │
│    → 12~15장 일괄 생성, SSE 스트리밍                        │
│                                                           │
│  Step 3: 승인 + LoRA                                      │
│    → 앵글별 승인/거부/재생성                                 │
│    → 캡셔닝 → LoRA 학습 (기존 파이프라인 재사용)              │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## Phase 1: Claude CLI + Blender 자동화

### 1-1. 웹 UI 입력

장소 등록 시 다음 정보를 입력:

```
{
  locationId: "classroom_3b",
  name: "3-B 교실",
  description: "일본 고등학교 교실. 가로 8m × 세로 6m × 높이 3m.
    책상 5열 × 6행, 정면에 칠판, 왼쪽 벽에 창문 3개,
    뒤쪽 벽에 출입문 1개, 교탁은 칠판 앞 중앙.",
  locationType: "main",
  promptBase: "Japanese high school classroom, afternoon sunlight..."
}
```

`description`은 3D 뼈대용 (치수, 가구 배치), `promptBase`는 ComfyUI 텍스처용 (분위기, 조명).

### 1-2. Claude CLI로 bpy 스크립트 생성

CLAUDE.md 규칙에 따라 LLM 호출은 Python FastAPI를 경유한다.

```
Node.js → POST /api/blender/generate-script
  → Python FastAPI: Claude CLI subprocess 호출
    → claude -p "{시스템 프롬프트}\n\n{사용자 설명}"
  → bpy 스크립트 문자열 반환
```

시스템 프롬프트 (blender-prompt 템플릿):
- 원기둥과 박스만 사용하여 공간 배치
- 카메라 12~15개 배치 (정면, 좌45, 우45, 역방향, 대각선, 하이앵글, 로우앵글, 클로즈업 등)
- 각 카메라에서 Depth Map + Normal Map을 1024x1024로 렌더링
- EEVEE 엔진 사용 (GPU 불필요)
- 출력 경로를 인자로 받도록

카메라 앵글 목록은 `blender-prompt.ts`에서 상수로 정의하여 Phase 2 프리셋과 1:1 매핑을 보장한다.

### 1-3. Blender CLI headless 실행

```bash
blender --background --python uploads/locations/classroom_3b/blender/setup.py
```

- `--background`: GUI 없는 headless 모드
- 스크립트가 depth/normal map을 지정 경로에 직접 저장
- 3090 불필요 — EEVEE + 단순 지오메트리, CPU 렌더링으로 충분
- 종료 코드로 성공/실패 판단

### 1-4. 결과 검증

블렌더 실행 후 자동 검증:
- `depth_maps/` 파일 수 == 예상 카메라 수
- `normal_maps/` 파일 수 == 예상 카메라 수
- 각 파일 크기 > 0, 해상도 1024x1024 확인
- 실패 시 에러 리포트 + 재시도 옵션

### 1-5. 웹 UI (Phase 1 결과 확인)

depth map 썸네일 그리드를 보여줌:
- "뼈대 확인 → Phase 2 진행" 버튼
- "설명 수정 → 재생성" 버튼
- 개별 카메라 삭제 가능

## Phase 2: ComfyUI ControlNet + IP-Adapter 렌더링

### 2-1. 앵커 후보 생성 (Step 1)

cam01(정면) depth/normal map으로 후보 4~8장 생성:

```
워크플로우:
  Load Image (cam01 depth map)
    → ControlNet Depth (strength: 0.8)
  Load Image (cam01 normal map)
    → ControlNet Normal (strength: 0.4)
  FLUX + 장소 promptBase
    → KSampler (시드 랜덤, 4~8장)
    → VAE Decode → 출력
```

기존 캐릭터 파이프라인과 동일한 후보 선택 UX:
- 카드 그리드, like 토글, 앵커 지정
- 선택된 앵커를 `style_anchor.png`로 저장

### 2-2. 전체 앵글 일괄 생성 (Step 2)

```
각 카메라(cam02~cam15)에 대해:

  Load Image (camNN depth map)
    → ControlNet Depth (strength: 0.8)
  Load Image (camNN normal map)
    → ControlNet Normal (strength: 0.4)
  Load Image (style_anchor.png)
    → IP-Adapter (strength: 0.45)
  FLUX + 장소 promptBase
    → KSampler → VAE Decode → 출력
```

- SSE 스트리밍으로 진행률 표시 (기존 derivative SSE 패턴 재사용)
- 각 이미지는 `renders/camNN_{angle}.png`로 저장
- `location_ref_images` 테이블에 angle 태그와 함께 INSERT

### 2-3. 승인 + LoRA (Step 3)

기존 파이프라인 그대로 재사용:
- 앵글별 승인/거부/재생성 (derivatives.ejs 패턴)
- 재생성 시: 해당 카메라의 depth/normal map + IP-Adapter + 수정 프롬프트
- 캡셔닝: Florence-2, trigger word `sks_{locationId}`
- LoRA 학습: dim=8, steps 800~1200 (기존 설정 유지)

### ControlNet Strength 가이드

| 노드 | 용도 | 추천 범위 | 비고 |
|------|------|-----------|------|
| ControlNet Depth | 구조 고정 | 0.7~0.9 | 높을수록 투시 엄격 |
| ControlNet Normal | 표면 보조 | 0.3~0.5 | 너무 높으면 텍스처 간섭 |
| IP-Adapter | 스타일 통일 | 0.4~0.5 | 높으면 앵글 변화 억제 |

## 3-Tier 장소 분류

모든 장소에 블렌더 뼈대를 만들 필요는 없다.

| 분류 | location_type | 파이프라인 | 예시 |
|------|--------------|-----------|------|
| 블렌더 + ControlNet | `main` | Phase 1 + Phase 2 전체 | 교실, 주인공 방, 메인 던전 |
| 배경 1장 고정 | `sub` | 기존 txt2img → 앵커 1장 선택 | 카페, 거리, 공원 |
| 프롬프트만 | `background` | 사용 시점에 일회성 생성 | 하늘, 복도, 계단 |

### 타입 전환

장소가 중요해지면 승격 가능:
- `background` → `sub`: 앵커 1장 생성/선택
- `sub` → `main`: 블렌더 뼈대 생성 (Phase 1부터 시작)
- `main` → `sub`: 블렌더 데이터 보관, 앵커만 사용

웹 UI에서 드롭다운으로 타입 변경 → 변경 시 필요한 다음 단계 안내 표시.

### sub 타입의 기존 파이프라인 유지

sub 타입은 현재 코드를 거의 그대로 사용:
- `buildKontextAnchorWorkflow()` (txt2img) → 후보 생성
- 앵커 선택 → `style_anchor.png` 저장
- derivative 생성 없음 (단일 배경)
- 캐릭터 합성은 에피소드 제작 단계에서 처리

## DB 변경

### locations 테이블 컬럼 추가

```sql
ALTER TABLE locations ADD (
  blender_script  CLOB,           -- bpy 스크립트 원본 (재현/수정용)
  description     VARCHAR2(2000)  -- 이미 존재하면 무시
);
```

### 기존 데이터 처리

main 타입 장소의 기존 candidates, ref_images, LoRA 데이터를 삭제하고 새 파이프라인으로 재생성.

## 폴더 구조

```
uploads/locations/{locationId}/
├── blender/
│   └── setup.py              ← bpy 스크립트
├── depth_maps/
│   ├── cam01_front.png
│   ├── cam02_left45.png
│   └── ...
├── normal_maps/
│   ├── cam01_front.png
│   └── ...
├── style_anchor.png          ← 선택된 스타일 앵커
├── renders/
│   ├── cam01_front.png
│   └── ...
└── candidates/
    └── {jobId}/
        ├── 001.png
        └── ...
```

## 코드 아키텍처

### 새로 만드는 파일

```
src/locations/services/
├── blender-script-generator.ts   ← Python FastAPI 경유 Claude CLI 호출
├── blender-renderer.ts           ← Blender CLI headless 실행 + 검증

src/locations/templates/
└── blender-prompt.ts             ← Claude CLI 시스템 프롬프트 + 카메라 앵글 상수

src/comfyui/workflows/
└── controlnet-workflows.ts       ← ControlNet Depth + Normal + IP-Adapter 워크플로우

src/web/views/locations/
└── blender-preview.ejs           ← Phase 1 결과 확인 화면

ai-services/routers/
└── blender_router.py             ← Claude CLI subprocess 엔드포인트
```

### 수정되는 파일

```
src/locations/routes/location-routes.ts            ← Phase 1 엔드포인트 추가
src/locations/routes/location-derivative-routes.ts  ← Phase 2 워크플로우 교체
src/locations/services/location-candidate-generator.ts  ← ControlNet 후보 생성으로 교체
src/locations/services/location-derivative-generator.ts ← ControlNet + IP-Adapter로 교체
src/locations/services/location-presets.ts              ← 카메라 ID ↔ 앵글 매핑으로 전환
src/db/schema.sql                                       ← blender_script 컬럼
src/db/queries/location-queries.ts                      ← 관련 쿼리
src/web/views/locations/manage.ejs                      ← 장소 등록 폼 강화
src/web/views/locations/candidates.ejs                  ← ControlNet 후보 생성
src/web/views/locations/derivatives.ejs                 ← IP-Adapter 일괄 생성
```

### 삭제/대체되는 코드

```
- buildFluxImg2ImgWorkflow() → controlnet-workflows.ts로 교체
- location-candidate-generator의 txt2img 로직 → ControlNet depth 후보로 교체
- location-derivative-generator의 img2img denoise 0.65 → ControlNet + IP-Adapter로 교체
- INDOOR_PRESETS / OUTDOOR_PRESETS의 promptSuffix → 카메라 ID 매핑으로 전환
```

### 서비스 책임

```
blender-script-generator.ts
  ├── generateBlenderScript(description, locationId, cameraCount)
  │   → Python FastAPI /api/blender/generate-script 호출
  │   → bpy 스크립트 문자열 반환
  └── saveScript(locationId, script)
      → 파일 저장 + DB blender_script 컬럼 업데이트

blender-renderer.ts
  ├── renderMaps(locationId, scriptPath)
  │   → blender --background --python {path}
  │   → depth_maps/, normal_maps/ 생성
  ├── validateResults(locationId, expectedCount)
  │   → 파일 수, 해상도, 크기 검증
  └── getMapPaths(locationId)
      → { depthMaps: string[], normalMaps: string[] }

controlnet-workflows.ts
  ├── buildControlNetCandidateWorkflow(depthMap, normalMap, prompt, seed)
  │   → Phase 2 Step 1 워크플로우 (앵커 후보)
  └── buildControlNetDerivativeWorkflow(depthMap, normalMap, styleAnchor, prompt, seed)
      → Phase 2 Step 2 워크플로우 (IP-Adapter 포함)
```

### API 엔드포인트

```
기존 유지:
  GET    /api/locations                              ← 목록
  POST   /api/locations                              ← 등록
  DELETE /api/locations/:locationId                   ← 삭제

Phase 1 (신규):
  POST   /api/locations/:locationId/generate-skeleton   ← Claude CLI + Blender 실행
  GET    /api/locations/:locationId/skeleton-stream      ← SSE (진행률)
  GET    /api/locations/:locationId/skeleton-preview     ← depth map 썸네일 목록
  POST   /api/locations/:locationId/regenerate-skeleton  ← 설명 수정 후 재생성

Phase 2 (기존 수정):
  POST   /api/locations/:locationId/generate-candidates   ← ControlNet 후보 생성
  POST   /api/locations/:locationId/set-anchor            ← 스타일 앵커 저장
  POST   /api/locations/:locationId/generate-derivatives  ← ControlNet + IP-Adapter
```

## ComfyUI 환경 셋업

### 커스텀 노드 설치

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Fannovel16/comfyui_controlnet_aux
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus
```

### 모델 다운로드

```
models/controlnet/instantx-flux-controlnet-union.safetensors
models/ipadapter/ip-adapter_flux.safetensors
models/clip_vision/clip-vit-large-patch14.safetensors
```

### FLUX ControlNet 전략

1순위: FLUX + ControlNet Union + IP-Adapter (스펙 그대로)
- `InstantX/FLUX.1-dev-Controlnet-Union` — depth/normal 등 7가지 모드 단일 모델
- `InstantX/FLUX.1-dev-IP-Adapter` + CLIP Vision ViT-L

2순위: FLUX + ControlNet Union만 (IP-Adapter 불안정 시)
- 스타일 앵커 대신 동일 시드 + 동일 프롬프트로 스타일 통일

3순위: SDXL로 전환 (FLUX ControlNet 자체가 불안정 시)
- ControlNet + IP-Adapter 생태계 완전 성숙
- 단, 기존 FLUX 파이프라인(캐릭터)과 모델 불일치

구현 시 1순위로 시작, 품질 검증 후 판단. 워크플로우 빌더를 분리해뒀으므로 전환 비용 낮음.

## 캡셔닝 + LoRA (기존 재사용)

기존 장소 LoRA 파이프라인을 그대로 유지:
- 캡셔닝: Florence-2, trigger word `sks_{locationId}`
- LoRA 학습: dim=8, alpha=8, steps 800~1200, lr=1e-4
- 추론 시 LoRA 스택: 캐릭터(0.7) + 장소(0.5~0.6), 합계 1.3~1.4 이하

## 이전 설계와의 관계

이 문서는 `2026-03-29-location-lora-pipeline-design.md`를 **대체**한다.
- Phase A~D 기반 인프라는 유지하되, 이미지 생성 엔진을 교체
- 캡셔닝/LoRA 학습 부분은 변경 없음
- DB 스키마에 `blender_script` 컬럼 추가
