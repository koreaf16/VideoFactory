/**
 * @module 파생 이미지 갤러리 API 라우터
 * @description 캐릭터 파생 이미지 조회 API.
 *
 * @dependencies express, db queries
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { listRefImagesByChar } from '../../db/queries/character-queries';

const router = Router();

// ─── 파생 이미지 갤러리 ───────────────────────────────────────

router.get(
  '/:charId/ref-images',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const conn = await getConnection();
    try {
      const rows = await listRefImagesByChar(conn, charId);
      res.json({
        success: true,
        data: rows.map((r) => ({
          refId: r.REF_ID,
          charId: r.CHAR_ID,
          imagePath: r.IMAGE_PATH,
          poseTag: r.POSE_TAG,
          qualityScore: r.QUALITY_SCORE,
          approved: r.APPROVED === 1,
          createdAt: r.CREATED_AT,
        })),
      });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
