/**
 * @module 파생 이미지 갤러리 API 라우터
 * @description 캐릭터 파생 이미지 조회/일괄 승인 API.
 *
 * +-----------+     +--------------------+     +----------+
 * | GET/PATCH |     | listAllRefImages   |     | Oracle   |
 * | /ref-     | --> | batchApprove       | --> | DB       |
 * |  images   |     | RefImages          |     |          |
 * +-----------+     +--------------------+     +----------+
 *
 * @dependencies express, character-queries
 * @author AI Video Factory
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../common/middleware/async-handler';
import { getConnection } from '../../db/connection';
import { listAllRefImagesByChar, batchApproveRefImages } from '../../db/queries/character-queries';

const router = Router();

// ─── 입력 검증 (테스트 가능하도록 export) ──────────────────────

export function parseApproveBatchBody(
  body: unknown,
): { refIds: number[]; approved: boolean } | null {
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.refIds) || b.refIds.length === 0) return null;
  if (typeof b.approved !== 'boolean') return null;
  return { refIds: b.refIds as number[], approved: b.approved };
}

// ─── 파생 이미지 갤러리 ───────────────────────────────────────

router.get(
  '/:charId/ref-images',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const conn = await getConnection();
    try {
      const rows = await listAllRefImagesByChar(conn, charId);
      res.json({
        success: true,
        data: rows.map((r) => ({
          refId: r.REF_ID,
          charId: r.CHAR_ID,
          imageUrl: `/api/images/char_ref_images/${r.REF_ID}`,
          thumbnailUrl: `/api/images/char_ref_images/${r.REF_ID}?thumbnail=true`,
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

// ─── 일괄 승인/취소 ───────────────────────────────────────────

router.patch(
  '/:charId/ref-images/approve-batch',
  asyncHandler(async (req: Request, res: Response) => {
    const charId = String(req.params.charId);
    const parsed = parseApproveBatchBody(req.body);

    if (!parsed) {
      res.status(400).json({
        success: false,
        error: 'refIds(비어있지 않은 배열)와 approved(boolean)가 필요합니다',
      });
      return;
    }

    const conn = await getConnection();
    try {
      const updated = await batchApproveRefImages(conn, charId, parsed.refIds, parsed.approved);
      res.json({ success: true, updated, charId });
    } finally {
      await conn.close();
    }
  }),
);

export default router;
