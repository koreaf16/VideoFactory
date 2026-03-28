/**
 * @module LoRA REST API 라우터
 * @description 데이터셋 CRUD, Florence-2 캡셔닝 SSE, 학습/체크포인트/추론 테스트 API.
 *
 * ┌──────────┐     ┌────────────┐     ┌──────────────────┐
 * │  Client  │ ──→ │  lora      │ ──→ │ lora-dataset     │
 * │  (API)   │     │  routes    │     │ lora-training    │
 * └──────────┘     └────────────┘     └──────────────────┘
 *
 * @dependencies express, lora-dataset, lora-training
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
} from '../services/lora-dataset';
import {
  startTraining,
  getTrainingJob,
  listCheckpoints,
  testCheckpoint,
  selectCheckpoint,
  trainingEvents,
} from '../services/lora-training';
import { logger } from '../../common/logger';
import type {
  CreateDatasetRequest,
  StartTrainingRequest,
  TestCheckpointRequest,
  SelectCheckpointRequest,
} from '../types/lora.types';

const router = Router();

// ─── 데이터셋 ─────────────────────────────────────────────

router.post(
  '/:charId/lora/dataset',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { name, triggerWord, imageIds } = req.body as CreateDatasetRequest;

    if (!name || !triggerWord || !imageIds?.length) {
      res.status(400).json({ success: false, error: 'name, triggerWord, imageIds는 필수입니다' });
      return;
    }

    const sourceType = (req.body as Record<string, unknown>).sourceType as string | undefined;
    const datasetId = await createDataset(
      charId,
      name,
      triggerWord,
      imageIds,
      sourceType ?? 'derivative',
    );

    logger.info('데이터셋 생성 API 호출', { charId, datasetId });
    res.json({ success: true, data: { datasetId } });
  }),
);

router.get(
  '/:charId/lora/dataset',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const rows = await getDatasetByChar(charId);
    res.json({ success: true, data: rows });
  }),
);

router.get(
  '/:charId/lora/dataset/images',
  asyncHandler(async (req: Request, res: Response) => {
    const datasetId = String(req.query.datasetId);

    if (!datasetId || datasetId === 'undefined') {
      res.status(400).json({ success: false, error: 'datasetId 쿼리 파라미터는 필수입니다' });
      return;
    }

    const images = await listDatasetImages(datasetId);
    res.json({ success: true, data: images });
  }),
);

// ─── 캡셔닝 ──────────────────────────────────────────────

router.post(
  '/:charId/lora/caption',
  asyncHandler(async (req: Request, res: Response) => {
    const { datasetId, triggerWord } = req.body as { datasetId: string; triggerWord: string };

    if (!datasetId || !triggerWord) {
      res.status(400).json({ success: false, error: 'datasetId, triggerWord는 필수입니다' });
      return;
    }

    // fire-and-forget
    startCaptioning(datasetId, triggerWord).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('캡셔닝 실패', { datasetId, error: msg });
    });

    logger.info('캡셔닝 시작 API 호출', { charId: String(req.params.charId), datasetId });
    res.json({ success: true, data: { datasetId, status: 'captioning' } });
  }),
);

router.get('/:charId/lora/caption/stream', (req: Request, res: Response) => {
  const datasetId = String(req.query.datasetId);

  if (!datasetId || datasetId === 'undefined') {
    res.status(400).json({ success: false, error: 'datasetId 쿼리 파라미터는 필수입니다' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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
  '/:charId/lora/caption/:imageId',
  asyncHandler(async (req: Request, res: Response) => {
    const imageId = String(req.params.imageId);
    const { caption } = req.body as { caption: string };

    if (!caption) {
      res.status(400).json({ success: false, error: 'caption은 필수입니다' });
      return;
    }

    await updateCaption(imageId, caption);
    res.json({ success: true, data: { imageId } });
  }),
);

// ─── 학습 ─────────────────────────────────────────────────

router.post(
  '/:charId/lora/train',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { datasetId, config: userConfig } = req.body as StartTrainingRequest;

    if (!datasetId) {
      res.status(400).json({ success: false, error: 'datasetId는 필수입니다' });
      return;
    }

    const jobId = await startTraining(charId, datasetId, userConfig);
    logger.info('학습 시작 API 호출', { charId, datasetId, jobId });
    res.json({ success: true, jobId });
  }),
);

router.get(
  '/:charId/lora/train/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = await getTrainingJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: '학습 작업을 찾을 수 없습니다' });
      return;
    }

    res.json({ success: true, data: job });
  }),
);

router.get('/:charId/lora/train/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  trainingEvents.on(`train:${jobId}`, onProgress);

  req.on('close', () => {
    trainingEvents.off(`train:${jobId}`, onProgress);
  });
});

// ─── 평가 ─────────────────────────────────────────────────

router.get(
  '/:charId/lora/checkpoints',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.query.jobId);

    if (!jobId || jobId === 'undefined') {
      res.status(400).json({ success: false, error: 'jobId 쿼리 파라미터는 필수입니다' });
      return;
    }

    const rows = await listCheckpoints(jobId);
    res.json({ success: true, data: rows });
  }),
);

router.post(
  '/:charId/lora/test',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { checkpointId, loraStrength } = req.body as TestCheckpointRequest;
    const triggerWord = (req.body as Record<string, unknown>).triggerWord as string | undefined;

    if (!checkpointId) {
      res.status(400).json({ success: false, error: 'checkpointId는 필수입니다' });
      return;
    }

    // fire-and-forget
    testCheckpoint(charId, checkpointId, triggerWord ?? '', loraStrength).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('체크포인트 테스트 실패', { charId, checkpointId, error: msg });
    });

    logger.info('체크포인트 테스트 시작 API 호출', { charId, checkpointId });
    res.json({ success: true, data: { checkpointId, status: 'testing' } });
  }),
);

router.get('/:charId/lora/test/stream', (req: Request, res: Response) => {
  const checkpointId = String(req.query.checkpointId);

  if (!checkpointId || checkpointId === 'undefined') {
    res.status(400).json({ success: false, error: 'checkpointId 쿼리 파라미터는 필수입니다' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  trainingEvents.on(`test:${checkpointId}`, onProgress);

  req.on('close', () => {
    trainingEvents.off(`test:${checkpointId}`, onProgress);
  });
});

router.post(
  '/:charId/lora/select',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const { checkpointId } = req.body as SelectCheckpointRequest;
    const jobId = String(req.query.jobId);

    if (!checkpointId) {
      res.status(400).json({ success: false, error: 'checkpointId는 필수입니다' });
      return;
    }
    if (!jobId || jobId === 'undefined') {
      res.status(400).json({ success: false, error: 'jobId 쿼리 파라미터는 필수입니다' });
      return;
    }

    await selectCheckpoint(charId, jobId, checkpointId);
    logger.info('체크포인트 선택 API 호출', { charId, jobId, checkpointId });
    res.json({ success: true, data: { charId, checkpointId } });
  }),
);

export default router;
