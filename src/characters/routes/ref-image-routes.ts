/**
 * @module ref-image 재생성 라우터
 * @description DB ref_id 기반 파생 이미지 재생성 API.
 *
 * @dependencies derivative-presets, derivative-image, character-queries
 * @author AI Video Factory
 */

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { getRefImage, getAnchorPath, DELETE_REF_IMAGE } from '../../db/queries/character-queries';
import { DERIVATIVE_PRESETS } from '../services/derivative-presets';
import type { DerivativePreset } from '../services/derivative-presets';
import { generateOneImage } from '../services/derivative-image';
import { ensureDir } from '../../common/utils/file-utils';
import { buildRegenPrompt } from '../services/derivative-generator';

const router = Router();

// ─── DB 기반 ref-image 재생성 ────────────────────────────────

router.post(
  '/ref-images/:refId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const refId = Number(req.params.refId);
    const { modifyPrompt } = req.body as { modifyPrompt?: string };

    const conn = await getConnection();
    try {
      const refImage = await getRefImage(conn, refId);
      if (!refImage) {
        res.status(404).json({ success: false, error: '이미지를 찾을 수 없습니다' });
        return;
      }

      const charId = refImage.CHAR_ID;
      const poseTag = refImage.POSE_TAG ?? '';
      const anchorPath = await getAnchorPath(conn, charId);
      if (!anchorPath) {
        res.status(400).json({ success: false, error: '앵커 이미지를 찾을 수 없습니다' });
        return;
      }

      const preset = DERIVATIVE_PRESETS.find((p) => p.label === poseTag);
      if (!preset) {
        res.status(400).json({ success: false, error: `프리셋을 찾을 수 없습니다: ${poseTag}` });
        return;
      }

      // 기존 파일 삭제
      if (fs.existsSync(refImage.IMAGE_PATH)) fs.unlinkSync(refImage.IMAGE_PATH);
      const thumbPath = path.join(
        path.dirname(refImage.IMAGE_PATH),
        `thumb_${path.basename(refImage.IMAGE_PATH)}`,
      );
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

      // 프롬프트 조합
      const combinedPreset: DerivativePreset = {
        ...preset,
        promptSuffix: buildRegenPrompt(preset.promptSuffix, modifyPrompt ?? ''),
      };

      // 출력 디렉토리: 기존 이미지와 같은 디렉토리
      const outDir = path.dirname(refImage.IMAGE_PATH);
      await ensureDir(outDir);

      // 임시 job 객체 생성 (generateOneImage가 요구)
      const tempJob = {
        jobId: `regen_${refId}`,
        charId,
        anchorPath,
        status: 'generating' as const,
        total: 1,
        completed: 0,
        generated: 0,
        deleted: 0,
        batch: 0,
        currentStep: '',
        results: [],
      };

      const newResult = await generateOneImage(tempJob, combinedPreset, '', outDir, () => {});
      if (!newResult) {
        res.status(500).json({ success: false, error: '이미지 생성 실패' });
        return;
      }

      // 기존 DB 레코드 삭제 (generateOneImage가 새 레코드를 이미 삽입함)
      await conn.execute(DELETE_REF_IMAGE, { refId }, { autoCommit: true });

      res.json({
        success: true,
        result: {
          refId: newResult.refId,
          imagePath: newResult.imagePath,
          label: newResult.label,
          prompt: newResult.prompt,
          seed: newResult.seed,
        },
      });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
