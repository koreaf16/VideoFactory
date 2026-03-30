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
import { getRefImage, getAnchorBlob, DELETE_REF_IMAGE } from '../../db/queries/character-queries';
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
      
      const anchorBlob = await getAnchorBlob(conn, charId);

      if (!anchorBlob) {
        res.status(400).json({ success: false, error: '앵커 이미지를 찾을 수 없습니다' });
        return;
      }

      const preset = DERIVATIVE_PRESETS.find((p) => p.label === poseTag);
      if (!preset) {
        res.status(400).json({ success: false, error: `프리셋을 찾을 수 없습니다: ${poseTag}` });
        return;
      }

      // 프롬프트 조합
      const combinedPreset: DerivativePreset = {
        ...preset,
        promptSuffix: buildRegenPrompt(preset.promptSuffix, modifyPrompt ?? ''),
      };

      // 출력 디렉토리: 임시 디렉토리 사용 (파일 저장은 부수 효과)
      const outDir = path.resolve('exports/tmp');
      await ensureDir(outDir);

      // 임시 job 객체 생성 (generateOneImage가 요구)
      const tempJob = {
        jobId: `regen_${refId}`,
        charId,
        anchorBlob,
        status: 'generating' as const,
        total: 1,
        completed: 0,
        generated: 0,
        deleted: 0,
        batch: 0,
        currentStep: '',
        results: [],
      };

      const newResult = await generateOneImage(tempJob, combinedPreset, '', outDir, () => {}, true);
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
          imageUrl: `/api/images/char_ref_images/${newResult.refId}`,
          thumbnailUrl: `/api/images/char_ref_images/${newResult.refId}?thumbnail=true`,
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
