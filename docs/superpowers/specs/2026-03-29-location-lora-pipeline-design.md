# 장소 LoRA 학습 파이프라인 설계

## 개요

영상에서 반복 등장하는 핵심 장소 2~3개를 LoRA로 학습하여 공간 일관성을 확보한다.
프롬프트만으로는 벽 위치, 창문 개수, 가구 배치가 매번 달라지므로, 자주 등장하는 장소는 LoRA 학습이 필수.

## 파이프라인 흐름

```
장소 등록 → 배경 후보 생성 (FLUX txt2img, 30~50장)
→ 앵커 선택 (1장 확정, seed 기록)
→ 앵글 변형 생성 (Kontext 편집, 10~15장)
→ 캡셔닝 (Florence-2, trigger word: sks_[location_id])
→ LoRA 학습 (dim=8, steps 800~1200)
→ 체크포인트 테스트/선택
```

## Phase 구성

### Phase A: 기반 인프라 (완료)
- `location_candidates` 테이블 DDL
- 장소 타입 정의 (`src/locations/types/location.types.ts`)
- DB 쿼리 모듈 (`src/db/queries/location-queries.ts`)
- 장소 CRUD API (`src/locations/routes/location-routes.ts`)
- 장소 관리 페이지 (`src/web/views/locations/manage.ejs`)
- 사이드바 메뉴 추가

### Phase B: 배경 후보 생성
- FLUX txt2img 워크플로우 (`src/comfyui/workflows/location-workflows.ts`)
- 배경 후보 생성 서비스 (`src/locations/services/location-candidate-generator.ts`)
- 후보 선택 페이지 (`src/web/views/locations/candidates.ejs`)
- SSE 진행률 스트리밍

### Phase C: 앵글 변형 + 갤러리
- 장소용 앵글 프리셋 12개 (`src/locations/services/location-presets.ts`)
- 앵글 변형 생성 서비스 (`src/locations/services/location-derivative-generator.ts`)
- 변형 검수 페이지 (`src/web/views/locations/derivatives.ejs`)
- 갤러리 뷰 (`src/web/views/locations/gallery.ejs`)

### Phase D: 캡셔닝 + LoRA 학습
- 기존 lora-dataset.ts / lora-training.ts 재활용
- 장소용 학습 파라미터 (dim=8, steps 800~1200)
- 장소 LoRA 학습 UI 연동

## 기준 배경 이미지 생성 (Phase B)

### 프롬프트 규칙
- 반드시 포함: `"empty room, no people, no characters, unoccupied"`
- 장소 고유 속성(벽 색, 가구, 조명) 상세 기술
- 해상도: 1024x1024 또는 1536x1024 (가로 넓은 구도 선택 가능)

### 프롬프트 예시

```
# 교실
"empty Japanese high school classroom, no people,
wooden desks arranged in rows, large green chalkboard on front wall,
windows on left side with afternoon sunlight streaming in,
white curtains, bulletin board on back wall,
clean floor, overhead fluorescent lights,
photorealistic, 8k, detailed interior photography"

# 주인공 방
"empty teenage girl bedroom, no people,
single bed with pink bedding against right wall,
wooden study desk with lamp near window,
bookshelf filled with books and small figures,
warm evening lighting, cozy atmosphere,
slightly messy but lived-in, photorealistic, 8k"
```

## 앵글 변형 프리셋 (Phase C)

### 기본 앵글 (5장)
1. 정면 전체 (기준 이미지 그대로)
2. 약간 왼쪽으로 회전한 시점
3. 약간 오른쪽으로 회전한 시점
4. 방 안쪽에서 입구 쪽을 바라보는 시점 (역방향)
5. 코너에서 대각선으로 바라보는 시점

### 높낮이 변형 (3장)
6. 약간 위에서 내려다보는 시점
7. 약간 아래에서 올려다보는 시점
8. 바닥 근처 낮은 앵글

### 부분 클로즈업 (3~4장)
9. 창문 쪽 클로즈업
10. 벽면/칠판 클로즈업
11. 가구 클로즈업
12. 문/입구 쪽 클로즈업

### Kontext 편집 프롬프트 규칙
- 모든 변형에 `"same room, same furniture layout, same wall colors, same decoration"` 포함
- 변경 사항만 명시 (앵글, 시점, 거리)

### 품질 검수 기준
- 벽 색상이 기준과 동일한가
- 주요 가구(책상, 칠판, 침대 등)가 존재하는가
- 전체적인 공간 분위기가 일관되는가
- 창문/문의 위치가 논리적으로 맞는가
- 이상한 물체가 새로 생기지 않았는가

## 캡셔닝 규칙 (Phase D)

### trigger word
- 형식: `sks_[location_id]` (예: `sks_classroom_3b`, `sks_mina_room`)

### 캡션 작성 규칙
1. trigger word 맨 앞 고정
2. `"empty"`, `"no people"` 포함 (사람이 학습되면 안 됨)
3. 공간 고유 속성(벽 색, 가구 종류)은 모든 캡션에 반복
4. 앵글/시점/클로즈업 부위는 이미지마다 정확히 서술

### 캡션 예시
```
sks_classroom_3b, empty classroom, wooden desks in rows,
green chalkboard on front wall, windows on left with sunlight,
white curtains, front view, wide angle

sks_classroom_3b, empty classroom, wooden desks in rows,
green chalkboard visible in distance, windows on right side,
view from back of room toward front, reverse angle
```

## LoRA 학습 파라미터 (장소용)

| 파라미터 | 캐릭터 | 장소 | 이유 |
|---------|--------|------|------|
| network_dim | 16 | 8 | 장소는 캐릭터보다 디테일이 적음 |
| network_alpha | 16 | 8 | dim과 동일 |
| max_train_steps | 1500 | 800~1200 | 과적합 방지 |
| learning_rate | 5e-5 | 1e-4 | 장소는 약간 높아도 됨 |

### 과적합 모니터링
- 다양한 앵글 프롬프트에 반응하는지 확인
- `"sks_classroom_3b, wide shot"` vs `"sks_classroom_3b, close-up of desk"` → 다르게 반응해야 정상
- 항상 같은 구도만 나오면 과적합 → 스텝 줄이거나 dim 줄이기

## 추론 시 LoRA 스택

```
캐릭터 LoRA: sks_mina (strength: 0.7)
장소 LoRA: sks_classroom_3b (strength: 0.5~0.6)

프롬프트:
"sks_mina wearing school uniform,
standing in sks_classroom_3b,
looking at chalkboard, afternoon sunlight,
medium shot from behind"
```

### LoRA 스택 주의사항
- 두 LoRA strength 합이 1.3~1.4를 넘지 않게 유지
- 장소 LoRA는 캐릭터보다 낮은 strength (0.5~0.6)
- 장소 LoRA가 너무 강하면 캐릭터 얼굴 품질 저하

## 장소 분류 기준

| 분류 | 기준 | 방식 | 예시 |
|------|------|------|------|
| LoRA 학습 (main) | 매 에피소드 등장, 다양한 앵글 필요 | 이 파이프라인 | 교실, 주인공 방 |
| 배경 고정 합성 (sub) | 1~2회 등장, 고정 앵글 | 배경 1장 + rembg 합성 | 카페, 거리, 공원 |
| 프롬프트만 (background) | 한 번 스쳐지나가는 장소 | 별도 관리 불필요 | 하늘, 복도, 계단 |

## 현재 구현 상태

- [x] Phase A: 기반 인프라
- [x] Phase B: 배경 후보 생성
- [x] Phase C: 앵글 변형 + 갤러리
- [x] Phase D: 캡셔닝 + LoRA 학습
