import { Router, Request, Response } from 'express';
import { getConnection } from '../../db/connection';
import oracledb from 'oracledb';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();

/**
 * DB에서 이미지 BLOB을 가져와서 서빙한다.
 * /api/images/:table/:id?thumbnail=true
 */
router.get(
  '/:table/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { table, id } = req.params;
    const isThumbnail = req.query.thumbnail === 'true';

    let sql = '';
    let blobCol = isThumbnail ? 'thumbnail_blob' : 'image_blob';

    switch (table) {
      case 'characters':
        blobCol = isThumbnail ? 'anchor_thumbnail' : 'anchor_blob';
        sql = `SELECT ${blobCol} FROM characters WHERE char_id = :id`;
        break;
      case 'char_candidates':
        sql = `SELECT ${blobCol} FROM char_candidates WHERE candidate_id = :id`;
        break;
      case 'char_ref_images':
        sql = `SELECT ${blobCol} FROM char_ref_images WHERE ref_id = :id`;
        break;
      case 'location_candidates':
        sql = `SELECT ${blobCol} FROM location_candidates WHERE candidate_id = :id`;
        break;
      case 'location_ref_images':
        sql = `SELECT ${blobCol} FROM location_ref_images WHERE ref_id = :id`;
        break;
      case 'lora_dataset_images':
        sql = `SELECT ${blobCol} FROM lora_dataset_images WHERE dataset_image_id = :id`;
        break;
      case 'lora_test_images':
        sql = `SELECT ${blobCol} FROM lora_test_images WHERE test_image_id = :id`;
        break;
      case 'anchors':
        sql = `SELECT ${blobCol} FROM anchor_images WHERE anchor_id = :id`;
        break;
      default:
        res.status(400).json({ success: false, error: 'Invalid table' });
        return;
    }

    const conn = await getConnection();
    try {
      const result = await conn.execute<Record<string, Buffer>>(
        sql,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0] as Record<string, Buffer> | undefined;
      const blob = row ? row[blobCol.toUpperCase()] : null;

      if (!blob) {
        res.status(404).send('Image not found');
        return;
      }

      res.setHeader('Content-Type', isThumbnail ? 'image/jpeg' : 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(blob);
    } finally {
      await conn.close();
    }
  }),
);

export default router;
