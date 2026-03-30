/**
 * @module 캐릭터 앵커 서비스
 * @description 캐릭터의 앵커 이미지 생성/관리 (공통 모듈 래퍼)
 *
 * ┌──────────────────────────┐     ┌──────────────────────┐
 * │ 캐릭터 앵커 서비스       │ ──→ │ 공통 생성 모듈       │
 * │ (엔티티 타입 바인딩)     │     │ (폴리모르픽)         │
 * └──────────────────────────┘     └──────────────────────┘
 *            ↓
 *   startAnchorGeneration
 *   setEntityAnchor
 *   getByEntity
 *
 * @dependencies anchor-image-generator, anchor-image-queries, oracledb
 * @author AI Video Factory
 */

import { startAnchorGeneration } from '../../common/services/anchor-image-generator';
import { getConnection } from '../../db/connection';
import { setEntityAnchor, getByEntity } from '../../db/queries/anchor-image-queries';
import { logger } from '../../common/logger';
import type { PulidModeOptions } from '../../common/types/anchor-image.types';

export async function startCharacterAnchorGeneration(
  charId: string,
  count: number,
  customPrompt?: string,
  pulidOpts?: PulidModeOptions,
): Promise<string> {
  return startAnchorGeneration({
    entityType: 'character',
    entityId: charId,
    count,
    customPrompt,
    pulidOpts,
  });
}

export async function setCharacterAnchor(
  charId: string,
  anchorId: number,
): Promise<void> {
  const conn = await getConnection();
  try {
    await setEntityAnchor(conn, 'character', charId, anchorId);
    logger.info('캐릭터 앵커 설정 완료', { charId, anchorId });
  } finally {
    await conn.close();
  }
}

export async function getCharacterAnchor(charId: string) {
  const conn = await getConnection();
  try {
    return await getByEntity(conn, 'character', charId);
  } finally {
    await conn.close();
  }
}
