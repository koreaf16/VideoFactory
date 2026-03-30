import fs from 'fs';
import path from 'path';
import oracledb from 'oracledb';
import sharp from 'sharp';
import { initPool, getConnection, closePool } from '../src/db/connection';
import { getFaceBoundingBox } from '../src/python-api/endpoints/embedding-api';
import { logger } from '../src/common/logger';

const LATEST_FOLDERS = {
  marcel: 'C:/VideoFactory/exports/derivatives/marcel/deriv_125e825fde39',
  soyul: 'C:/VideoFactory/exports/derivatives/soyul/deriv_0fb32ee544a6',
};

async function processImage(conn: oracledb.Connection, charId: string, filePath: string) {
  const fileName = path.basename(filePath);
  if (fileName.startsWith('thumb_')) {
    return;
  }

  // Extract pose_tag: marcel_정면 미소_816745156.png -> 정면 미소
  const parts = fileName.replace('.png', '').split('_');
  const poseTag = parts.length >= 2 ? parts[1] : 'unknown';

  logger.info(`Processing ${charId}: ${fileName} (tag: ${poseTag})`);

  try {
    const imageBuffer = fs.readFileSync(filePath);
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(256, 256, { fit: 'inside' })
      .toFormat('jpg')
      .toBuffer();

    // Call Python API for face_bbox
    const bboxResp = await getFaceBoundingBox(filePath);
    let faceBbox: string | null = null;
    if (bboxResp.success && bboxResp.data) {
      faceBbox = JSON.stringify(bboxResp.data);
    } else {
      logger.warn(`Failed to get face bbox for ${fileName}: ${bboxResp.error}`);
    }

    const sql = `
      INSERT INTO char_ref_images (
        char_id,
        image_path,
        image_blob,
        thumbnail_blob,
        pose_tag,
        face_bbox,
        is_custom,
        approved
      ) VALUES (
        :char_id,
        :image_path,
        :image_blob,
        :thumbnail_blob,
        :pose_tag,
        :face_bbox,
        :is_custom,
        :approved
      )
    `;

    await conn.execute(sql, {
      char_id: charId,
      image_path: filePath,
      image_blob: imageBuffer,
      thumbnail_blob: thumbnailBuffer,
      pose_tag: poseTag,
      face_bbox: faceBbox,
      is_custom: 0,
      approved: 1,
    }, { autoCommit: true });

    logger.info(`Successfully imported ${fileName}`);
  } catch (err) {
    logger.error(`Error processing image ${filePath}`, { error: err });
  }
}

async function cleanup() {
  const derivativesRoot = 'C:/VideoFactory/exports/derivatives';
  const characters = ['marcel', 'soyul'];

  for (const charId of characters) {
    const charDir = path.join(derivativesRoot, charId);
    if (!fs.existsSync(charDir)) continue;

    const latestDir = LATEST_FOLDERS[charId as keyof typeof LATEST_FOLDERS];
    const dirs = fs.readdirSync(charDir);

    for (const dirName of dirs) {
      const fullPath = path.join(charDir, dirName);
      if (fs.statSync(fullPath).isDirectory()) {
        if (path.resolve(fullPath) !== path.resolve(latestDir)) {
          logger.info(`Deleting old derivative folder: ${fullPath}`);
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      }
    }
  }

  const candidatesDir = 'C:/VideoFactory/exports/candidates';
  if (fs.existsSync(candidatesDir)) {
    logger.info(`Deleting candidates folder: ${candidatesDir}`);
    fs.rmSync(candidatesDir, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await initPool();
    const conn = await getConnection();

    for (const [charId, folderPath] of Object.entries(LATEST_FOLDERS)) {
      if (!fs.existsSync(folderPath)) {
        logger.warn(`Folder not found: ${folderPath}`);
        continue;
      }

      const files = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.png'));
      for (const file of files) {
        await processImage(conn, charId, path.join(folderPath, file));
      }
    }

    await conn.close();

    // Perform cleanup
    await cleanup();

    logger.info('Import and cleanup completed successfully');
  } catch (err) {
    logger.error('Main execution failed', { error: err });
  } finally {
    await closePool();
  }
}

main();
