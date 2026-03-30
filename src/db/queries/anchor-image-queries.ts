/**
 * @module 앵커 이미지 쿼리
 * @description anchor_images 테이블 CRUD 쿼리
 *
 * ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
 * │ Service      │ ──→ │ anchor-image │ ──→ │ Oracle DB   │
 * │ (캐릭터/장소)  │     │ queries      │     │ CRUD        │
 * └──────────────┘     └──────────────┘     └─────────────┘
 *        ↓
 *   AnchorInsertData
 *   AnchorImageRow
 *
 * @dependencies oracledb, logger, anchor-image.types
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';
import type { AnchorImageRow, AnchorInsertData } from '../../common/types/anchor-image.types';

export const INSERT_ANCHOR = `
  INSERT INTO anchor_images
    (entity_type, entity_id, image_blob, thumbnail_blob,
     job_id, prompt_text, seed, quality_score, grade, face_bbox)
  VALUES
    (:entityType, :entityId, :imageBlob, :thumbnailBlob,
     :jobId, :promptText, :seed, :qualityScore, :grade, :faceBbox)
  RETURNING anchor_id INTO :anchorId
`;

export const LIST_BY_JOB = `
  SELECT * FROM anchor_images
   WHERE job_id = :jobId
   ORDER BY anchor_id DESC
`;

export const GET_ANCHOR = `
  SELECT * FROM anchor_images WHERE anchor_id = :anchorId
`;

export const GET_BY_ENTITY = `
  SELECT * FROM anchor_images
   WHERE entity_type = :entityType AND entity_id = :entityId
`;

/**
 * 앵커 이미지를 저장하고 anchor_id 반환
 * @param conn Oracle connection
 * @param data 앵커 이미지 데이터
 * @returns 생성된 anchor_id
 */
export async function insertAnchor(
  conn: oracledb.Connection,
  data: AnchorInsertData,
): Promise<number> {
  try {
    const binds = {
      ...data,
      anchorId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    };
    const result = await conn.execute(INSERT_ANCHOR, binds as unknown as Record<string, unknown>, {
      autoCommit: true,
    });
    const outBinds = result.outBinds as unknown as { anchorId: number[] };
    const anchorId = outBinds.anchorId[0];
    logger.debug('앵커 이미지 저장', {
      entityType: data.entityType,
      entityId: data.entityId,
      anchorId,
    });
    return anchorId;
  } catch (error) {
    logger.error('앵커 이미지 저장 실패', { data, error });
    throw error;
  }
}

/**
 * 특정 jobId로 생성된 모든 앵커 이미지 조회
 * @param conn Oracle connection
 * @param jobId 생성 작업 ID
 * @returns 앵커 이미지 행 배열
 */
export async function listByJob(
  conn: oracledb.Connection,
  jobId: string,
): Promise<AnchorImageRow[]> {
  try {
    const result = await conn.execute<AnchorImageRow>(
      LIST_BY_JOB,
      { jobId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    logger.debug('앵커 목록 조회', { jobId, count: result.rows?.length ?? 0 });
    return result.rows ?? [];
  } catch (error) {
    logger.error('앵커 목록 조회 실패', { jobId, error });
    throw error;
  }
}

/**
 * 특정 anchor_id로 앵커 이미지 조회
 * @param conn Oracle connection
 * @param anchorId 앵커 ID
 * @returns 앵커 이미지 행 또는 null
 */
export async function getAnchor(
  conn: oracledb.Connection,
  anchorId: number,
): Promise<AnchorImageRow | null> {
  try {
    const result = await conn.execute<AnchorImageRow>(
      GET_ANCHOR,
      { anchorId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    logger.debug('앵커 조회', { anchorId });
    return result.rows?.[0] ?? null;
  } catch (error) {
    logger.error('앵커 조회 실패', { anchorId, error });
    throw error;
  }
}

/**
 * 엔티티(캐릭터/장소)에 설정된 앵커 이미지 조회
 * @param conn Oracle connection
 * @param entityType 엔티티 타입 ('character' | 'location' | 'npc')
 * @param entityId 엔티티 ID
 * @returns 앵커 이미지 행 또는 null
 */
export async function getByEntity(
  conn: oracledb.Connection,
  entityType: string,
  entityId: string,
): Promise<AnchorImageRow | null> {
  try {
    const result = await conn.execute<AnchorImageRow>(
      GET_BY_ENTITY,
      { entityType, entityId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    logger.debug('엔티티 앵커 조회', { entityType, entityId });
    return result.rows?.[0] ?? null;
  } catch (error) {
    logger.error('엔티티 앵커 조회 실패', { entityType, entityId, error });
    throw error;
  }
}

/**
 * 캐릭터 또는 장소에 앵커 이미지 설정
 * @param conn Oracle connection
 * @param entityType 엔티티 타입 ('character' | 'location')
 * @param entityId 엔티티 ID
 * @param anchorId 앵커 ID
 */
export async function setEntityAnchor(
  conn: oracledb.Connection,
  entityType: string,
  entityId: string,
  anchorId: number,
): Promise<void> {
  try {
    // entity_type에 따라 분기
    if (entityType === 'character') {
      await conn.execute(
        'UPDATE characters SET anchor_id = :anchorId WHERE char_id = :entityId',
        { anchorId, entityId },
        { autoCommit: true },
      );
    } else if (entityType === 'location') {
      await conn.execute(
        'UPDATE locations SET anchor_id = :anchorId WHERE location_id = :entityId',
        { anchorId, entityId },
        { autoCommit: true },
      );
    }
    logger.info('엔티티 앵커 설정', { entityType, entityId, anchorId });
  } catch (error) {
    logger.error('엔티티 앵커 설정 실패', { entityType, entityId, anchorId, error });
    throw error;
  }
}

/**
 * 캐릭터 또는 장소에서 앵커 이미지 해제
 * @param conn Oracle connection
 * @param entityType 엔티티 타입 ('character' | 'location')
 * @param entityId 엔티티 ID
 */
export async function clearEntityAnchor(
  conn: oracledb.Connection,
  entityType: string,
  entityId: string,
): Promise<void> {
  try {
    if (entityType === 'character') {
      await conn.execute(
        'UPDATE characters SET anchor_id = NULL WHERE char_id = :entityId',
        { entityId },
        { autoCommit: true },
      );
    } else if (entityType === 'location') {
      await conn.execute(
        'UPDATE locations SET anchor_id = NULL WHERE location_id = :entityId',
        { entityId },
        { autoCommit: true },
      );
    }
    logger.info('엔티티 앵커 해제', { entityType, entityId });
  } catch (error) {
    logger.error('엔티티 앵커 해제 실패', { entityType, entityId, error });
    throw error;
  }
}
