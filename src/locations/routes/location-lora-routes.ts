/**
 * @module 장소 LoRA 라우트
 * @description 장소 데이터셋 생성, 캡셔닝, 학습 API.
 *
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import {
  createDataset,
  getDatasetByChar,
  listDatasetImages,
  startCaptioning,
  updateCaption,
  datasetEvents,
} from '../../characters/services/lora-dataset';
import {
  startTraining,
  getTrainingJob,
  listCheckpoints,
  selectCheckpoint,
  trainingEvents,
} from '../../characters/services/lora-training';
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
  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  datasetEvents.on(`caption:${datasetId}`, onProgress);
  req.on('close', () => {
    datasetEvents.off(`caption:${datasetId}`, onProgress);
  });
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
    if (!job) {
      res.status(404).json({ success: false, error: '작업 없음' });
      return;
    }
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
  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  trainingEvents.on(`train:${jobId}`, onProgress);
  req.on('close', () => {
    trainingEvents.off(`train:${jobId}`, onProgress);
  });
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
