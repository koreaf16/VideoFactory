# 장소 Phase D: 캡셔닝 + LoRA 학습 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장소 변형 이미지에 Florence-2 자동 캡셔닝을 적용하고, 장소용 LoRA 학습(dim=8, steps 800~1200)을 실행할 수 있도록 기존 LoRA 인프라를 장소에 연동한다.

**Architecture:** 기존 lora-dataset.ts, lora-training.ts, lora-caption.ts를 재활용한다. 장소용 기본 학습 설정(dim=8, steps 1000)을 lora.types.ts에 추가한다. 장소 LoRA 라우트를 새로 만들어 location-routes.ts에 마운트한다. trigger word는 `sks_[location_id]` 형식.

**Tech Stack:** Express, Oracle 26ai, ComfyUI (Florence-2, FluxTrainer)

---

### Task 1: 장소용 LoRA 학습 기본 설정 추가

**Files:**
- Modify: `src/characters/types/lora.types.ts`

- [ ] **Step 1: 장소용 기본 config 추가**

파일 하단, `DEFAULT_TRAINING_CONFIG` 뒤에 추가:

```typescript
export const LOCATION_TRAINING_CONFIG: LoraTrainingConfig = {
  networkDim: 8,
  networkAlpha: 8,
  learningRate: 1e-4,
  lrScheduler: 'cosine',
  maxTrainSteps: 1000,
  trainBatchSize: 1,
  gradientAccumulation: 2,
  mixedPrecision: 'bf16',
  optimizer: 'AdamW8bit',
  saveEveryNSteps: 200,
  seed: 42,
};
```

- [ ] **Step 2: LoraDataset의 charId를 범용 ownerId로 확장하거나, 장소용 소스 타입 추가**

`DatasetSourceType`을 확장하지 않고, 기존 `sourceType: 'candidate' | 'derivative'`에 `'location_ref'`를 추가한다.

`lora.types.ts`에서 `LoraDatasetImage` 인터페이스의 sourceType을 수정:

```typescript
export interface LoraDatasetImage {
  readonly datasetImageId: string;
  readonly datasetId: string;
  readonly sourceType: 'candidate' | 'derivative' | 'location_ref';
  readonly sourceId: string;
  // ... 나머지 동일
}
```

- [ ] **Step 3: Commit**

```bash
git add src/characters/types/lora.types.ts
git commit -m "feat: add location LoRA training config and source type"
```

---

### Task 2: 장소 LoRA 라우트

**Files:**
- Create: `src/locations/routes/location-lora-routes.ts`

- [ ] **Step 1: 장소 LoRA 라우트 파일 생성**

```typescript
/**
 * @module 장소 LoRA 라우트
 * @description 장소 데이터셋 생성, 캡셔닝, 학습 API.
 *
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { createDataset, getDatasetByChar, listDatasetImages, startCaptioning, updateCaption, datasetEvents } from '../../characters/services/lora-dataset';
import { startTraining, getTrainingJob, listCheckpoints, selectCheckpoint, trainingEvents } from '../../characters/services/lora-training';
import { LOCATION_TRAINING_CONFIG } from '../../characters/types/lora.types';
import type { LoraTrainingConfig } from '../../characters/types/lora.types';

const router = Router();

// ─── 데이터셋 생성 ─────────────────────────────────────

router.post(
  '/:locationId/lora/dataset',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const { name, triggerWord, imageIds } = req.body as {
      name: string;
      triggerWord: string;
      imageIds: string[];
    };
    if (!name || !triggerWord || !imageIds?.length) {
      res.status(400).json({ success: false, error: 'name, triggerWord, imageIds 필수' });
      return;
    }
    const datasetId = await createDataset(locationId, name, triggerWord, imageIds, 'location_ref');
    res.json({ success: true, datasetId });
  }),
);

// ─── 데이터셋 조회 ─────────────────────────────────────

router.get(
  '/:locationId/lora/dataset',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const datasets = await getDatasetByChar(locationId);
    res.json({ success: true, data: datasets });
  }),
);

router.get(
  '/:locationId/lora/dataset/images',
  asyncHandler(async (req: Request, res: Response) => {
    const datasetId = String(req.query.datasetId);
    const images = await listDatasetImages(datasetId);
    res.json({ success: true, data: images });
  }),
);

// ─── 캡셔닝 ────────────────────────────────────────────

router.post(
  '/:locationId/lora/caption',
  asyncHandler(async (req: Request, res: Response) => {
    const { datasetId, triggerWord } = req.body as { datasetId: string; triggerWord: string };
    if (!datasetId || !triggerWord) {
      res.status(400).json({ success: false, error: 'datasetId, triggerWord 필수' });
      return;
    }
    await startCaptioning(datasetId, triggerWord);
    res.json({ success: true });
  }),
);

router.get('/:locationId/lora/caption/stream', (req: Request, res: Response) => {
  const datasetId = String(req.query.datasetId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const onProgress = (data: unknown): void => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
  datasetEvents.on(`caption:${datasetId}`, onProgress);
  req.on('close', () => { datasetEvents.off(`caption:${datasetId}`, onProgress); });
});

router.put(
  '/:locationId/lora/caption/:imageId',
  asyncHandler(async (req: Request, res: Response) => {
    const { caption } = req.body as { caption: string };
    await updateCaption(String(req.params.imageId), caption);
    res.json({ success: true });
  }),
);

// ─── 학습 ───────────────────────────────────────────────

router.post(
  '/:locationId/lora/train',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const { datasetId, config } = req.body as {
      datasetId: string;
      config?: Partial<LoraTrainingConfig>;
    };
    if (!datasetId) {
      res.status(400).json({ success: false, error: 'datasetId 필수' });
      return;
    }
    const merged = { ...LOCATION_TRAINING_CONFIG, ...config };
    const jobId = await startTraining(locationId, datasetId, merged);
    res.json({ success: true, jobId });
  }),
);

router.get(
  '/:locationId/lora/train/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const job = await getTrainingJob(String(req.params.jobId));
    if (!job) { res.status(404).json({ success: false, error: '작업 없음' }); return; }
    res.json({ success: true, data: job });
  }),
);

router.get('/:locationId/lora/train/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const onProgress = (data: unknown): void => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
  trainingEvents.on(`train:${jobId}`, onProgress);
  req.on('close', () => { trainingEvents.off(`train:${jobId}`, onProgress); });
});

// ─── 체크포인트 ─────────────────────────────────────────

router.get(
  '/:locationId/lora/checkpoints/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const checkpoints = await listCheckpoints(String(req.params.jobId));
    res.json({ success: true, data: checkpoints });
  }),
);

router.post(
  '/:locationId/lora/checkpoints/:checkpointId/select',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const checkpointId = String(req.params.checkpointId);
    const { jobId } = req.body as { jobId: string };
    await selectCheckpoint(locationId, jobId, checkpointId);
    res.json({ success: true });
  }),
);

export default router;
```

- [ ] **Step 2: location-routes.ts에 마운트**

```typescript
import locationLoraRoutes from './location-lora-routes';
```

```typescript
router.use('/', locationLoraRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add src/locations/routes/location-lora-routes.ts src/locations/routes/location-routes.ts
git commit -m "feat: add location LoRA dataset, captioning, and training routes"
```

---

### Task 3: 갤러리 LoRA 버튼 활성화

**Files:**
- Modify: `src/web/views/locations/gallery.ejs`

- [ ] **Step 1: LoRA 학습 버튼을 활성화**

갤러리 하단의 disabled LoRA 버튼을 활성화. 클릭 시:
1. 현재 ref_images의 refId 목록을 수집
2. `POST /api/locations/{locationId}/lora/dataset` 호출 (triggerWord: `sks_{locationId}`)
3. 성공 시 캡셔닝 시작: `POST /api/locations/{locationId}/lora/caption`
4. 진행 표시 후 학습 페이지로 이동 (또는 같은 페이지에서 진행률 표시)

간단하게: 버튼 클릭 → 데이터셋 생성 + 캡셔닝 시작 → alert로 완료 알림.

- [ ] **Step 2: Commit**

```bash
git add src/web/views/locations/gallery.ejs
git commit -m "feat: enable LoRA training button in location gallery"
```

---

### Task 4: 빌드 확인

- [ ] **Step 1: TypeScript 컴파일**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 2: 설계 문서 업데이트**

`docs/superpowers/specs/2026-03-29-location-lora-pipeline-design.md` 체크리스트를 업데이트:
```markdown
- [x] Phase A: 기반 인프라
- [x] Phase B: 배경 후보 생성
- [x] Phase C: 앵글 변형 + 갤러리
- [x] Phase D: 캡셔닝 + LoRA 학습
```
