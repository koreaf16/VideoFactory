/**
 * @module 장소 변형 SSE/조회 라우터
 * @description 장소 앵글 변형 생성 SSE 스트리밍, 중단, 재생성 API.
 *
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import {
  getLocDerivJob,
  locDerivEvents,
  stopLocDerivGeneration,
} from '../services/location-derivative-generator';

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

// TODO: Migrate ref-images endpoint to anchor_images table
// router.get(
//   '/:locationId/ref-images',
//   asyncHandler(async (req: Request, res: Response) => {
//     const locationId = String(req.params.locationId);
//     const conn = await getConnection();
//     try {
//       const result = await conn.execute<LocRefImageRow>(
//         LIST_LOC_REF_IMAGES,
//         { locationId },
//         { outFormat: oracledb.OUT_FORMAT_OBJECT },
//       );
//       const rows = result.rows ?? [];
//       res.json({
//         success: true,
//         data: rows.map((r) => ({
//           refId: r.REF_ID,
//           locationId: r.LOCATION_ID,
//           imageUrl: `/api/images/location_ref_images/${r.REF_ID}`,
//           angle: r.ANGLE,
//           approved: r.APPROVED === 1,
//           createdAt: r.CREATED_AT,
//         })),
//       });
//     } finally {
//       await conn.close();
//     }
//   }),
// );

// ─── 재생성 API ──────────────────────────────────────────
// TODO: Migrate regenerate endpoint to anchor_images table

/*
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

      // Fetch location for promptBase
      const locR = await conn.execute<LocationRow>(
        FIND_LOCATION_BY_ID,
        { locationId: ref.LOCATION_ID },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const loc = locR.rows?.[0];
      const promptBase = loc?.PROMPT_BASE ?? '';

      const preset = ref.ANGLE ? getPresetByAngle(ref.ANGLE) : undefined;
      if (!preset) {
        res.status(400).json({ success: false, error: '프리셋 없음' });
        return;
      }

      // Find depth/normal maps for this camera
      const { depthMaps, normalMaps } = getMapPaths(ref.LOCATION_ID);
      const depthFile = depthMaps.find((f) => path.basename(f, '.png') === preset.cameraId);
      const normalFile = normalMaps.find((f) => path.basename(f, '.png') === preset.cameraId);
      if (!depthFile) {
        res
          .status(400)
          .json({ success: false, error: 'depth map 없음. Phase 1을 먼저 실행하세요.' });
        return;
      }

      const seed = Math.floor(Math.random() * 999999999);

      // Upload depth/normal maps to ComfyUI
      await comfyuiClient.connect();
      const depthName = await comfyuiClient.uploadImage(depthFile);
      const normalName = normalFile ? await comfyuiClient.uploadImage(normalFile) : depthName;

      // Get style anchor
      const styleAnchorPath = path.join('uploads/locations', ref.LOCATION_ID, 'style_anchor.png');
      if (!fs.existsSync(styleAnchorPath)) {
        res
          .status(400)
          .json({ success: false, error: 'style_anchor.png 없음. 앵커를 먼저 선택하세요.' });
        return;
      }
      const styleAnchorName = await comfyuiClient.uploadImage(styleAnchorPath);

      // Build prompt with regeneration hint
      const regenPrompt = modifyPrompt
        ? `${promptBase}, ${preset.regenHint}, ${modifyPrompt}`
        : `${promptBase}, ${preset.regenHint}`;

      const wf = buildControlNetDerivativeWorkflow({
        depthMapName: depthName,
        normalMapName: normalName,
        styleAnchorName,
        prompt: regenPrompt,
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
      const thumb = await createThumbnail(buf);

      // Delete old record and insert new one with image BLOB
      await conn.execute(
        'DELETE FROM location_ref_images WHERE ref_id = :refId',
        { refId },
        { autoCommit: true },
      );
      const ins = await conn.execute(
        `INSERT INTO location_ref_images (location_id, image_blob, thumbnail_blob, angle, approved)
         VALUES (:lid, :ib, :tb, :angle, 1) RETURNING ref_id INTO :newId`,
        {
          lid: ref.LOCATION_ID,
          ib: buf,
          tb: thumb,
          angle: preset.angle,
          newId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );
      const newRefId = (ins.outBinds as unknown as { newId: number[] }).newId[0];

      res.json({
        success: true,
        result: { refId: newRefId, imageUrl: `/api/images/location_ref_images/${newRefId}`, label: preset.label, angle: preset.angle, seed },
      });
    } finally {
      await conn.close();
    }
  }),
);
*/

export default router;
