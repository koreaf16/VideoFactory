# LoRA 캐릭터 학습 파이프라인 설계

> 작성: 2026-03-28
> 최종 업데이트: 2026-03-29
> 범위: `src/characters/` 도메인 확장 + ComfyUI 워크플로우

---

## 1. 개요

FLUX.1 Dev + Kontext [dev] 기반으로 캐릭터 LoRA 학습용 데이터셋을 생성하고, ComfyUI 워크플로우를 통해 학습까지 수행하는 엔드투엔드 파이프라인.

**모델 사용 구분:**
- **앵커 생성 (txt2img):** FLUX.1 Dev — 다양한 얼굴 생성에 최적화
- **파생 생성 (img2img):** FLUX.1 Kontext Dev — 이미지 편집/일관성 유지에 최적화
- **PuLID 모드:** FLUX.1 Dev + PuLID — 레퍼런스 얼굴 신원 유지

**전체 흐름:** 앵커 이미지 생성 -> 파생 이미지 생성 -> 캡셔닝 -> LoRA 학습 -> 추론 테스트

**자동화 수준:** 단계별 수동 제어 (B) -- 웹 UI에서 각 단계를 개별 실행하고 중간 결과 확인 후 다음 단계 진행. 추후 풀 자동화(A)로 전환 예정.

---

## 2. 아키텍처

### 결정 사항

| 항목 | 결정 |
|------|------|
| 통합 방식 | 기존 `src/characters/` 확장 |
| 이미지 생성 | FLUX.1 Kontext [dev], ComfyUI 경유 통일 |
| 학습 실행 | ComfyUI-FluxTrainer 커스텀 노드 |
| 캡셔닝 | ComfyUI-Florence2 커스텀 노드 |
| 데이터 저장 | Oracle DB (원본 저장소) |
| ComfyUI 서버 | 192.168.0.3:8188 -- 커스텀 노드만 추가, 별도 서비스 없음 |
| Gemini | 전부 삭제 |
| 라이선스 | 현 단계 보류, 기술 구현 우선 |

### 시스템 구조

```
+----------------------------------------------------------+
|                  Node.js (localhost:3000)                 |
|                                                          |
|  src/characters/services/                                |
|   +-- candidate-generator.ts   (후보 생성 오케스트레이션)|
|   +-- candidate-processor.ts   (개별 후보 1장 처리)      |
|   +-- prompt-builder.ts        (프롬프트 조립)           |
|   +-- derivative-generator.ts  (Kontext 편집 워크플로우) |
|   +-- derivative-filter.ts     (얼굴 유사도 필터링)      |
|   +-- lora-dataset.ts          * 신규 (데이터셋+캡셔닝)  |
|   +-- lora-training.ts         * 신규 (학습+평가)        |
|                                                          |
|  src/characters/templates/                               |
|   +-- global-style.ts          (공통 품질 프롬프트)      |
|   +-- character-tags.ts        (외모 → 프롬프트 태그)    |
|   +-- scene-types.ts           (장면 프리셋)             |
|   +-- time-weather.ts          (조명 프리셋)             |
|   +-- negative-prompts.ts      (네거티브 프롬프트)       |
|                                                          |
|  src/comfyui/                                            |
|   +-- client.ts                (WebSocket/HTTP 클라이언트)|
|   +-- workflows/kontext-workflows.ts (워크플로우 빌더)   |
|        +-- buildKontextAnchorWorkflow()  앵커 (Flux Dev) |
|        +-- buildPulidAnchorWorkflow()    PuLID (Flux Dev)|
|        +-- buildKontextEditWorkflow()    파생 (Kontext)  |
|                                                          |
|  Oracle DB <- 모든 데이터의 원본 저장소                   |
|   (이미지 BLOB + 캡션 + 메타데이터)                      |
+-------------------------+--------------------------------+
                          | WebSocket + HTTP
                          v
+----------------------------------------------------------+
|            ComfyUI 서버 (192.168.0.3:8188)               |
|                                                          |
|  커스텀 노드:                                             |
|   +-- ComfyUI-PuLID-Flux         (PuLID 얼굴 임베딩)    |
|   +-- ComfyUI-FluxTrainer        (LoRA 학습)             |
|   +-- ComfyUI-Florence2          (자동 캡셔닝)           |
|   +-- ComfyUI-GGUF               (양자화 모델)           |
|   +-- ComfyUI-ADetailer          (얼굴 후보정)           |
|   +-- ComfyUI-Advanced-ControlNet                        |
|   +-- comfyui_controlnet_aux     (OpenPose 등)           |
|                                                          |
|  모델:                                                    |
|   +-- FLUX.1 Dev FP8             diffusion_models/       |
|   +-- FLUX.1 Kontext [dev]       diffusion_models/       |
|   +-- PuLID Flux v0.9.1          models/pulid/           |
|   +-- VAE (ae.safetensors)       vae/                    |
|   +-- CLIP (clip_l + t5xxl)      clip/                   |
|                                                          |
|  * 별도 서비스 없음. 순수 ComfyUI만 운영.                |
|  * 학습 데이터는 임시 스테이징, 영구 저장은 Oracle DB.   |
+----------------------------------------------------------+
```

---

## 3. 파이프라인 흐름

### STEP 1: 앵커 이미지 생성 — 2가지 모드 지원 ✅ 구현 완료

웹 UI (`/characters`) 모달에서 모드 선택:
- **모드 A: 레퍼런스 기반** — PuLID + Flux Dev
- **모드 B: 프롬프트만** — Flux Dev

두 모드 모두 **FLUX.1 Dev** 모델을 사용한다 (Kontext가 아님).
Kontext는 이미지 편집(img2img) 전용이라 txt2img에서 얼굴 다양성이 부족하기 때문.

---

#### 모드 A: 레퍼런스 사진 기반 생성 (PuLID)

사용자가 마음에 드는 얼굴 사진을 넣으면, PuLID가 그 얼굴 특징(골격, 비율, 눈 크기, 턱선 등)을 반영한 새로운 AI 캐릭터를 만든다.

**필요 모델 (ComfyUI 서버):**
- `pulid_flux_v0.9.1.safetensors` → `ComfyUI/models/pulid/`
- EVA CLIP 얼굴 인코더 (PuLID 노드가 자동 로딩)
- InsightFace 얼굴 분석 모델 (PuLID 노드가 자동 로딩)

**ComfyUI 커스텀 노드:**
- `ComfyUI-PuLID-Flux` (`cubiq/ComfyUI-PuLID-Flux`)
  - `PuLIDFluxModelLoader` — PuLID 모델 로드, 출력: PULIDFLUX
  - `PuLIDFluxEvaClipLoader` — EVA CLIP 로드, 출력: EVA_CLIP
  - `PuLIDFluxInsightFaceLoader` — InsightFace 로드 (provider: CUDA), 출력: FACEANALYSIS
  - `ApplyPuLIDFlux` — 4개 입력 결합하여 MODEL에 PuLID 적용

**프롬프트 규칙 (중요):**
- PuLID 모드에서는 **얼굴 신원(identity) 태그를 전부 제외**한다
  - ❌ 머리색, 눈색, 피부톤, 메이크업 스타일, distinct facial features
  - ✅ 의상, 체형, 악세서리, 구도, 조명, 포토리얼 품질 태그
- 프롬프트가 얼굴을 묘사하면 PuLID 레퍼런스를 덮어쓰므로 반드시 제외
- 코드: `generatePulidAnchorPrompts()` → `buildCharacterTagsForPulid()` 사용

**PuLID 파라미터:**
| 파라미터 | 값 | 설명 |
|---------|-----|------|
| weight | 0.3~0.8 (기본 0.55) | 얼굴 반영 강도 |
| fusion | concat | 얼굴 임베딩 결합 방식 |
| start_at / end_at | 0.0 / 1.0 | 전 구간 적용 |
| train_step | 1000 | 내부 파라미터 |
| use_gray | true | 그레이스케일 참조 |

**ComfyUI 노드 구조:**
```
[1]  UNETLoader (flux1-dev-fp8)          ──→ MODEL
[2]  DualCLIPLoader (clip_l + t5xxl)     ──→ CLIP
[3]  VAELoader (ae.safetensors)          ──→ VAE
[4]  LoadImage (레퍼런스 사진)            ──→ IMAGE
[5]  PuLIDFluxModelLoader (v0.9.1)       ──→ PULIDFLUX
[13] PuLIDFluxEvaClipLoader              ──→ EVA_CLIP
[14] PuLIDFluxInsightFaceLoader (CUDA)   ──→ FACEANALYSIS
[6]  ApplyPuLIDFlux                      ──→ MODEL (PuLID 적용됨)
     ├─ model: [1]
     ├─ pulid_flux: [5]
     ├─ eva_clip: [13]
     ├─ face_analysis: [14]
     ├─ image: [4]
     └─ weight/fusion/...
[7]  CLIPTextEncode (프롬프트)            ──→ CONDITIONING
[8]  FluxGuidance (guidance: 3.5)        ──→ CONDITIONING
[9]  EmptyLatentImage (1024x1024)        ──→ LATENT
[10] KSampler (cfg:1.0, steps:28, euler) ──→ LATENT
[11] VAEDecode                           ──→ IMAGE
[12] SaveImage                           ──→ 출력
```

---

#### 모드 B: 프롬프트만으로 생성

레퍼런스 없이 텍스트 프롬프트와 시드 가챠로 원하는 얼굴을 찾는다.

**2가지 프롬프트 경로:**
1. **프롬프트 비움** → DB 캐릭터 외모 데이터에서 자동 생성 (`generateAnchorCandidatePrompts()`)
   - 표정(2) × 각도(2) = 4 조합을 count만큼 반복
   - 품질 프리픽스 + 구도 + 캐릭터 태그(머리색, 눈색 등) + 표정 + 앵글 + 조명
2. **프롬프트 직접 입력** → 포토리얼 품질 프리픽스 자동 추가 후 그대로 사용
   - 프리픽스: `RAW photo, sharp focus, 8k, photorealistic, highly detailed skin texture, visible pores, 85mm lens, professional photography`
   - 10가지 앵커 변형(정면/미소/진지 등)을 자동 추가

**ComfyUI 노드 구조:**
```
[1] UNETLoader (flux1-dev-fp8)          ──→ MODEL
[2] DualCLIPLoader                      ──→ CLIP
[3] VAELoader                           ──→ VAE
[4] CLIPTextEncode (프롬프트)            ──→ CONDITIONING
[5] FluxGuidance (guidance: 3.5)        ──→ CONDITIONING
[6] EmptyLatentImage (1024x1024)        ──→ LATENT
[7] KSampler (cfg:1.0, steps:28, euler) ──→ LATENT
[8] VAEDecode                           ──→ IMAGE
[9] SaveImage                           ──→ 출력
```

---

#### 두 모드 공통사항

**앵커 이미지 생성 팁:**
- Guidance Scale: **3.0~3.5** 권장 (높을수록 프롬프트 반영 강화)
- 최소 **30장 이상** 뽑고 그 중 고르는 시드 가챠 방식이 필수
- 해상도: 1024x1024 (기본)

**앵커 선정 기준:**
- 얼굴 특징이 명확하고 자연스러움
- 손/손가락 등 해부학적 오류 없음
- 캐릭터 콘셉트에 부합
- 선택 후 **seed 번호가 DB에 자동 기록**

**앵커 확정 흐름 (웹 UI):**
1. `/characters` → 캐릭터 카드 → "후보 생성" 클릭
2. 모달에서 모드/프롬프트/개수 설정 → "생성 시작"
3. `/characters/candidates/:jobId` → 후보 그리드 (실시간 SSE 스트리밍)
4. 마음에 드는 이미지 클릭 → "이 이미지로 앵커 확정"
5. `POST /api/characters/candidates/:jobId/anchor` → 앵커 DB 저장
6. **자동으로 파생 이미지 생성 시작** → `/characters/derivatives/:jobId`로 리다이렉트

> **⚠ 중요:** 모드 A에서 뷰티 LoRA를 같이 쓴 경우, 이후 파생 이미지 생성과 LoRA 학습 시에는 **뷰티 LoRA와 PuLID를 끈다.** 최종 내 LoRA는 외부 도구 의존 없이 독립적으로 동작해야 한다. 뷰티 LoRA와 PuLID는 "이쁜 앵커 원본을 만드는 도구"로만 사용하고, 파생 이미지는 Kontext 에디팅으로 앵커 이미지만 입력해서 생성한다.

### STEP 2: 파생 이미지 생성 (얼굴 LoRA 전용) ✅ 구현 완료

앵커 확정 시 **자동 트리거**됨. `derivative-generator.ts` 가 처리.

**사용 모델:** FLUX.1 Kontext Dev (`flux1-dev-kontext_fp8_scaled.safetensors`)
- Kontext는 이미지 편집에 특화 → 앵커 얼굴 일관성 유지하면서 포즈/표정 변경에 최적

**워크플로우:** `buildKontextEditWorkflow()`
```
[1]  UNETLoader (flux1-dev-kontext)      ──→ MODEL
[2]  DualCLIPLoader                      ──→ CLIP
[3]  VAELoader                           ──→ VAE
[4]  LoadImage (앵커 이미지)              ──→ IMAGE
[5]  VAEEncode (앵커 → latent)           ──→ LATENT (reference)
[6]  CLIPTextEncode (편집 프롬프트)       ──→ CONDITIONING
[7]  FluxGuidance (guidance: 5.0)        ──→ CONDITIONING
[8]  ReferenceLatent (ref latent 결합)   ──→ CONDITIONING
[9]  EmptyLatentImage (1024x1024)        ──→ LATENT (noise)
[10] KSampler (cfg:1.0, denoise:1.0)    ──→ LATENT
[11] VAEDecode                           ──→ IMAGE
[12] SaveImage                           ──→ 출력
```

**프리셋 (13개):**

| # | 포즈/표정 | 타입 | 유사도 필터 |
|---|----------|------|-----------|
| 1 | 정면 미소 | 얼굴 클로즈업 | ✅ |
| 2 | 정면 진지 | 얼굴 클로즈업 | ✅ |
| 3 | 정면 놀람 | 얼굴 클로즈업 | ✅ |
| 4 | 좌측 45도 미소 | 얼굴 클로즈업 | ✅ |
| 5 | 우측 45도 미소 | 얼굴 클로즈업 | ✅ |
| 6 | 좌측 45도 진지 | 얼굴 클로즈업 | ✅ |
| 7 | 측면 프로필 | 얼굴 클로즈업 | ❌ (skipSimilarity) |
| 8 | 살짝 고개숙임 | 얼굴 클로즈업 | ✅ |
| 9 | 웃음 클로즈업 | 얼굴 클로즈업 | ✅ |
| 10 | 화난 표정 | 얼굴 클로즈업 | ✅ |
| 11 | 슬픈 표정 | 얼굴 클로즈업 | ✅ |
| 12 | 윙크 | 얼굴 클로즈업 | ✅ |
| 13 | 정면 상반신 | 상반신 | ✅ |

**전신/뒷모습 전부 제외** — 품질 나쁜 이미지는 넣는 것보다 빼는 게 낫다.

**유사도 필터링 (`derivative-filter.ts`):**
- 생성 완료 후 Python `compareFaces()` API로 앵커 대비 얼굴 유사도 측정
- 임계값: `FACE_SIMILARITY_THRESHOLD = 0.4`
- 비유사 이미지 자동 삭제 (파일 + DB)
- `skipSimilarity: true`인 프리셋(측면 프로필)은 필터 제외

**웹 UI (`/characters/derivatives/:jobId`):**
- SSE 실시간 스트리밍으로 진행 표시
- 상태: `preparing → generating → filtering → completed`
- 통계: 유사 확보 / 총 생성 / 삭제 / 배치
- 결과 이미지 그리드 + 중지 버튼
- Oracle DB `char_ref_images` 테이블에 저장

### STEP 3: 데이터셋 준비 + 캡셔닝

- 승인된 이미지를 DB에서 꺼내 ComfyUI에 업로드 (`/upload/image`)
- ComfyUI Florence-2 캡셔닝 워크플로우로 각 이미지 순차 처리
- 캡션 결과를 Oracle DB에 저장
- Node.js 후처리: trigger_word 삽입 + 캐릭터 고유속성 보정
- 웹 UI에서 캡션 검토/수정

**캡션 구조:** `[trigger_word], [얼굴/표정/각도 중심 캡션]`

**★ 얼굴 LoRA 캡셔닝 규칙:**
- 이 LoRA는 **얼굴 LoRA**이다. 전신 프롬프트 사용 시 몸/의상/체형은 베이스 모델이 생성한다.
- 데이터셋은 얼굴 클로즈업(12장) + 상반신(3장)으로만 구성한다.
- Florence-2 자동 캡션에서 의상/체형 서술이 과도하면 수동 보정 권장.
- LoRA는 얼굴 일관성만 담당하며, 전신/의상/배경은 프롬프트 + 베이스 모델에 위임.

### STEP 4: LoRA 학습

- 학습 데이터 스테이징:
  1. Node.js가 Oracle DB에서 확정된 이미지+캡션 조회
  2. ComfyUI `/upload/image` API로 이미지 업로드 (input/ 디렉토리)
  3. FluxTrainer 워크플로우에 이미지 목록과 캡션을 노드 입력으로 전달
- ComfyUI FluxTrainer 학습 워크플로우 실행
- 학습 파라미터:
  - network_dim: 16, network_alpha: 16
  - learning_rate: 5e-5, lr_scheduler: cosine
  - max_train_steps: 1500, batch_size: 1
  - gradient_accumulation: 2, mixed_precision: bf16
  - optimizer: AdamW8bit, save_every_n_steps: 200
- 진행률 WebSocket 메시지로 수신 -> SSE로 웹 UI에 전달
- 체크포인트는 ComfyUI `models/loras/{char_id}/`에 저장
- 학습 완료 후 input/의 임시 이미지 정리

### STEP 5: 체크포인트 평가

- ComfyUI (Kontext + LoRA 적용 워크플로우)
- 고정 테스트 프롬프트 5종 x 체크포인트별 생성
- 웹 UI에서 비교 그리드 -> 최적 체크포인트 선택

**테스트 프롬프트:**
1. `[trigger], standing in the rain, holding umbrella, city street, night`
2. `[trigger], wearing formal suit, office background, serious expression`
3. `[trigger], beach setting, summer outfit, bright daylight, smiling`
4. `[trigger], reading a book, library, warm lighting, seated`
5. `[trigger], action pose, running, outdoor park, dynamic angle`

### STEP 6: 최종 확정

- 선택된 LoRA -> `character.loraPath` DB 업데이트
- 미사용 체크포인트 정리

---

## 4. DB 스키마

### 신규 테이블

```sql
-- LoRA 데이터셋
lora_datasets (
  dataset_id        VARCHAR2(36)  PK,
  char_id           VARCHAR2(36)  FK -> characters,
  name              VARCHAR2(100),
  trigger_word      VARCHAR2(50),
  status            VARCHAR2(20),  -- preparing|captioning|ready|training|completed
  image_count       NUMBER,
  created_at        TIMESTAMP
)

-- 데이터셋 이미지 + 캡션
lora_dataset_images (
  dataset_image_id  VARCHAR2(36)  PK,
  dataset_id        VARCHAR2(36)  FK -> lora_datasets,
  source_type       VARCHAR2(20),  -- 'candidate' | 'derivative'
  source_id         VARCHAR2(36),
  image_path        VARCHAR2(500),
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  pose_tag          VARCHAR2(50),
  caption_auto      CLOB,
  caption_edited    CLOB,
  approved          NUMBER(1)     DEFAULT 1,
  created_at        TIMESTAMP
)

-- 학습 작업
lora_training_jobs (
  job_id            VARCHAR2(36)  PK,
  dataset_id        VARCHAR2(36)  FK -> lora_datasets,
  char_id           VARCHAR2(36)  FK -> characters,
  status            VARCHAR2(20),  -- queued|training|completed|failed
  config            CLOB,          -- JSON
  current_step      NUMBER         DEFAULT 0,
  total_steps       NUMBER,
  started_at        TIMESTAMP,
  completed_at      TIMESTAMP,
  error_message     VARCHAR2(2000)
)

-- 체크포인트
lora_checkpoints (
  checkpoint_id     VARCHAR2(36)  PK,
  job_id            VARCHAR2(36)  FK -> lora_training_jobs,
  step_number       NUMBER,
  file_name         VARCHAR2(500),
  is_selected       NUMBER(1)     DEFAULT 0,
  created_at        TIMESTAMP
)

-- 테스트 이미지
lora_test_images (
  test_image_id     VARCHAR2(36)  PK,
  checkpoint_id     VARCHAR2(36)  FK -> lora_checkpoints,
  prompt_text       VARCHAR2(2000),
  seed              NUMBER,
  lora_strength     NUMBER(3,2),
  image_path        VARCHAR2(500),
  image_blob        BLOB,
  thumbnail_blob    BLOB,
  created_at        TIMESTAMP
)
```

---

## 5. API 설계

### REST 엔드포인트 (`src/characters/routes/lora-routes.ts`)

```
데이터셋:
POST   /api/characters/:charId/lora/dataset             데이터셋 생성
GET    /api/characters/:charId/lora/dataset              데이터셋 정보
GET    /api/characters/:charId/lora/dataset/images       이미지+캡션 목록

캡셔닝:
POST   /api/characters/:charId/lora/caption              자동 캡셔닝 시작
GET    /api/characters/:charId/lora/caption/stream       캡셔닝 진행 SSE
PUT    /api/characters/:charId/lora/caption/:imageId     캡션 수동 수정

학습:
POST   /api/characters/:charId/lora/train                학습 시작
GET    /api/characters/:charId/lora/train/:jobId         학습 상태
GET    /api/characters/:charId/lora/train/:jobId/stream  학습 진행 SSE

평가:
GET    /api/characters/:charId/lora/checkpoints          체크포인트 목록
POST   /api/characters/:charId/lora/test                 테스트 이미지 생성
GET    /api/characters/:charId/lora/test/stream          테스트 진행 SSE
POST   /api/characters/:charId/lora/select               최종 체크포인트 선택
```

---

## 6. ComfyUI 워크플로우

### 필수 커스텀 노드

| 노드 | 용도 |
|------|------|
| ComfyUI-KontextWrapper | Kontext 이미지 생성/편집 |
| ComfyUI-FluxTrainer (kijai) | LoRA 학습 |
| ComfyUI-Florence2 | 자동 캡셔닝 |
| ComfyUI-GGUF | 양자화 모델 로딩 |
| ComfyUI-ADetailer | 얼굴 후보정 |
| ComfyUI-Advanced-ControlNet | ControlNet 적용 |
| comfyui_controlnet_aux | OpenPose/Depth 전처리 |

### 워크플로우 1: 앵커 생성 (text-to-image)

```
LoadDiffusionModel (FLUX.1 Kontext dev)
  -> CLIPTextEncode (캐릭터 프롬프트)
    -> KSampler (steps: 8-10, cfg: 2.5-3.5, euler, seed 지정)
      -> VAEDecode (ae.safetensors)
        -> ADetailer (얼굴 보정, 선택적)
          -> SaveImage
```

Node.js에서 동적 제어하는 값: prompt, seed, steps, cfg

### 워크플로우 2: 파생 생성 (image editing)

```
LoadImage (앵커, /upload/image로 업로드)
  -> KontextSampler (image + edit prompt, guidance: 2.5)
    -> VAEDecode
      -> ADetailer (선택적)
        -> SaveImage
```

16+ 프리셋:
- 구도: 정면 클로즈업, 전신, 좌/우 45도, 좌/우 측면, 뒷모습, 하이/로우 앵글
- 포즈: 앉기, 걷기, 손 흔들기, 팔짱, 물건 들기
- 배경: 야외 자연광, 실내 따뜻한 조명, 도시 거리, 자연 풍경
- 표정: 웃음, 진지, 놀람

### 워크플로우 3: Florence-2 캡셔닝

```
LoadImage (데이터셋 이미지)
  -> Florence2Run (task: detailed_caption)
    -> Output: caption text
```

### 워크플로우 4: LoRA 학습

```
FluxTrainSetup
  +-- model: FLUX.1 Kontext dev
  +-- dataset: 이미지+캡션 (input/ 에 스테이징)
  +-- output_dir: models/loras/{char_id}/
  +-- network_dim: 16, network_alpha: 16
  +-- learning_rate: 5e-5, lr_scheduler: cosine
  +-- max_train_steps: 1500, batch_size: 1
  +-- gradient_accumulation: 2, mixed_precision: bf16
  +-- optimizer: AdamW8bit
  +-- save_every_n_steps: 200
  -> FluxTrainExecute
    -> SaveLoRA
```

데이터 스테이징 절차:
1. Node.js -> Oracle DB에서 이미지+캡션 조회
2. ComfyUI `/upload/image` API로 이미지를 input/ 디렉토리에 업로드
3. FluxTrainer 워크플로우 노드에 이미지 목록+캡션 텍스트 전달
4. 학습 완료 후 input/의 임시 이미지 정리

### 워크플로우 5: LoRA 추론 테스트

```
LoadDiffusionModel (FLUX.1 Kontext dev)
  -> LoadLoRA (체크포인트, strength: 0.6~0.8)
    -> CLIPTextEncode (테스트 프롬프트)
      -> KSampler (steps: 8-10, cfg: 2.5-3.5)
        -> VAEDecode
          -> SaveImage
```

### workflow-builder.ts 함수

```
기존 유지:  buildSdxlWorkflow(), buildFluxWorkflow()
신규 추가:  buildKontextAnchorWorkflow()
            buildKontextEditWorkflow()
            buildCaptionWorkflow()
            buildLoraTrainWorkflow()
            buildLoraInferenceWorkflow()
```

정확한 노드 이름/파라미터는 구현 시 실제 커스텀 노드에 맞춰 조정.

---

## 7. 파일 구조

### 신규 파일

```
src/characters/
  types/
    lora.types.ts                  LoRA 관련 인터페이스
  services/
    lora-dataset.ts                데이터셋 구성 + 캡셔닝 오케스트레이션
    lora-training.ts               학습 실행 + 모니터링
  routes/
    lora-routes.ts                 REST 엔드포인트

src/db/queries/
  lora-queries.ts                  5개 테이블 CRUD

src/web/
  views/characters/
    lora-dataset.ejs               데이터셋 + 캡션 검토 UI
    lora-training.ejs              학습 모니터 + 체크포인트 평가 UI
  public/js/
    lora.js                        LoRA UI 인터랙션
```

### 수정 파일

```
src/comfyui/workflow-builder.ts    5개 워크플로우 함수 추가
src/characters/services/
  candidate-generator.ts           Gemini -> Kontext 워크플로우로 교체
  derivative-generator.ts          Gemini -> Kontext 편집 워크플로우로 교체
  prompt-builder.ts                Kontext 프롬프트 구조로 수정
src/config.ts                      gemini 설정 제거
package.json                       @google/genai 의존성 제거
```

### 삭제 파일

```
src/gemini/                        디렉토리 전체
```

---

## 8. 웹 UI

### lora-dataset.ejs -- 데이터셋 준비

- 승인된 파생 이미지 그리드 (체크박스로 학습용 선별)
- trigger_word 설정 필드
- "캡셔닝 시작" 버튼 -> 진행률 바
- 이미지별 캡션 표시 + 인라인 편집
- "데이터셋 확정" 버튼

### lora-training.ejs -- 학습 & 평가

- 학습 파라미터 설정 폼 (steps, lr, dim, alpha)
- "학습 시작" 버튼 -> 실시간 진행률 (step/loss)
- 체크포인트 목록 (200스텝마다)
- 체크포인트별 테스트 이미지 비교 그리드
- "이 체크포인트 선택" 버튼

---

## 9. 파일 네이밍 규칙

```
LoRA 체크포인트:
  {model}_{dim}_lr{lr}_step{steps}_{date}.safetensors
  예: flux1_kontext_r16_lr5e-5_s1500_20260328.safetensors

데이터셋 이미지:
  {번호}_{구도}_{포즈}.png / .txt
  예: 001_front_closeup.png, 001_front_closeup.txt
```

---

## 10. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| OOM 에러 | VRAM 부족 | batch_size=1, gradient_accumulation으로 보상, t5xxl을 fp8로 |
| 캐릭터가 안 닮음 | 학습 부족 또는 캡션 문제 | 스텝 증가, 캡션에 trigger word 확인 |
| 모든 이미지가 똑같음 | 과적합 | 스텝 줄이기, dim 줄이기, 데이터 다양성 확보 |
| 얼굴만 닮고 몸 이상 | 얼굴 위주 데이터 | 전신샷 비율 높이기 |
| 배경이 항상 같음 | 데이터 배경 다양성 부족 | 파생 이미지에서 배경 변형 추가 |
