/**
 * @module 장소 변형 SSE/조회 라우터
 * @description 장소 앵글 변형 생성 SSE 스트리밍, 중단, 재생성 API.
 *
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import oracledb from 'oracledb';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import {
  getLocDerivJob,
  locDerivEvents,
  stopLocDerivGeneration,
} from '../services/location-derivative-generator';
import {
  LIST_LOC_REF_IMAGES,
  GET_LOC_ANCHOR_PATH,
} from '../../db/queries/location-candidate-queries';
import type { LocRefImageRow } from '../../db/queries/location-candidate-queries';
import { LOCATION_PRESETS } from '../services/location-presets';
import { comfyuiClient } from '../../comfyui/client';
import { buildKontextEditWorkflow } from '../../comfyui/workflows/kontext-workflows';
import { config } from '../../config';
import { ensureDir, writeFileBuffer } from '../../common/utils/file-utils';
import { createThumbnail } from '../../common/utils/image-utils';

const router = Router();

// ─── SSE: 변형 진행률 ────────────────────────────────────

router.get('/derivatives/:jobId/stream', (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const job = getLocDerivJob(jobId);
  if (!job) {
    res.status(404).json({ error: '작업 없음' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(
    `data: ${JSON.stringify({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      completed: job.completed,
      currentStep: job.currentStep,
      results: job.results,
    })}\n\n`,
  );

  const onProgress = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  locDerivEvents.on(`job:${jobId}`, onProgress);
  req.on('close', () => {
    locDerivEvents.off(`job:${jobId}`, onProgress);
  });
});

router.post(
  '/derivatives/:jobId/stop',
  asyncHandler(async (req: Request, res: Response) => {
    const stopped = stopLocDerivGeneration(String(req.params.jobId));
    if (!stopped) {
      res.status(404).json({ success: false, error: '작업 없음' });
      return;
    }
    res.json({ success: true });
  }),
);

// ─── 갤러리 API ──────────────────────────────────────────

router.get(
  '/:locationId/ref-images',
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = String(req.params.locationId);
    const conn = await getConnection();
    try {
      const result = await conn.execute<LocRefImageRow>(
        LIST_LOC_REF_IMAGES,
        { locationId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const rows = result.rows ?? [];
      res.json({
        success: true,
        data: rows.map((r) => ({
          refId: r.REF_ID,
          locationId: r.LOCATION_ID,
          imagePath: r.IMAGE_PATH,
          angle: r.ANGLE,
          approved: r.APPROVED === 1,
          createdAt: r.CREATED_AT,
        })),
      });
    } finally {
      await conn.close();
    }
  }),
);

// ─── 재생성 API ──────────────────────────────────────────

router.post(
  '/ref-images/:refId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const refId = Number(req.params.refId);
    const { modifyPrompt } = req.body as { modifyPrompt?: string };

    const conn = await getConnection();
    try {
      const r = await conn.execute<LocRefImageRow>(
        'SELECT * FROM location_ref_images WHERE ref_id = :refId',
        { refId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const ref = r.rows?.[0];
      if (!ref) {
        res.status(404).json({ success: false, error: '이미지 없음' });
        return;
      }

      const anchorR = await conn.execute<{ IMAGE_PATH: string }>(
        GET_LOC_ANCHOR_PATH,
        { locationId: ref.LOCATION_ID },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const anchorPath = anchorR.rows?.[0]?.IMAGE_PATH;
      if (!anchorPath) {
        res.status(400).json({ success: false, error: '앵커 없음' });
        return;
      }

      const preset = LOCATION_PRESETS.find((p) => p.angle === ref.ANGLE);
      if (!preset) {
        res.status(400).json({ success: false, error: '프리셋 없음' });
        return;
      }

      if (ref.IMAGE_PATH && fs.existsSync(ref.IMAGE_PATH)) fs.unlinkSync(ref.IMAGE_PATH);
      const thumbP = path.join(
        path.dirname(ref.IMAGE_PATH),
        `thumb_${path.basename(ref.IMAGE_PATH)}`,
      );
      if (fs.existsSync(thumbP)) fs.unlinkSync(thumbP);

      const editPrompt = modifyPrompt
        ? `${preset.regenHint} Additionally: ${modifyPrompt}`
        : preset.regenHint;

      const seed = Math.floor(Math.random() * 999999999);
      await comfyuiClient.connect();
      const anchorName = await comfyuiClient.uploadImage(anchorPath);
      const wf = buildKontextEditWorkflow({
        anchorImageName: anchorName,
        editPrompt,
        seed,
        filenamePrefix: `${ref.LOCATION_ID}_${preset.angle}_${seed}`,
      });
      const pid = await comfyuiClient.submitWorkflow(wf);
      const { images } = await comfyuiClient.waitForResult(pid, 300_000);
      if (images.length === 0) {
        res.status(500).json({ success: false, error: '생성 실패' });
        return;
      }

      const imageUrl = `${config.comfyui.httpUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder ?? ''}&type=${images[0].type ?? 'output'}`;
      const buf = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
      const outDir = path.dirname(ref.IMAGE_PATH);
      await ensureDir(outDir);
      const filename = `${ref.LOCATION_ID}_${preset.angle}_${seed}.png`;
      const imagePath = path.join(outDir, filename);
      await writeFileBuffer(imagePath, buf);
      await writeFileBuffer(path.join(outDir, `thumb_${filename}`), await createThumbnail(buf));

      await conn.execute(
        'DELETE FROM location_ref_images WHERE ref_id = :refId',
        { refId },
        { autoCommit: true },
      );
      const ins = await conn.execute(
        `INSERT INTO location_ref_images (location_id, image_path, angle, approved)
         VALUES (:lid, :ip, :angle, 1) RETURNING ref_id INTO :newId`,
        {
          lid: ref.LOCATION_ID,
          ip: imagePath,
          angle: preset.angle,
          newId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );
      const newRefId = (ins.outBinds as unknown as { newId: number[] }).newId[0];

      res.json({
        success: true,
        result: { refId: newRefId, imagePath, label: preset.label, angle: preset.angle, seed },
      });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
