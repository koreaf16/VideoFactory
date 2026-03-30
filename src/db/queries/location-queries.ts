/**
 * @module 장소 쿼리
 * @description locations 테이블 SQL 쿼리.
 *              location_candidates / location_ref_images 쿼리는 location-candidate-queries.ts 참조.
 *
 * @dependencies oracledb
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { logger } from '../../common/logger';

// ─── SQL 상수 ────────────────────────────────────────────

export const LIST_LOCATIONS = `
  SELECT location_id, name, name_en, region_id, location_type,
         prompt_base, description, first_ep, created_at
    FROM locations
   ORDER BY created_at DESC
`;

export const FIND_LOCATION_BY_ID = `
  SELECT location_id, name, name_en, region_id, location_type,
         prompt_base, description, first_ep, created_at
    FROM locations
   WHERE location_id = :locationId
`;

export const INSERT_LOCATION = `
  INSERT INTO locations
    (location_id, name, name_en, location_type, prompt_base, description)
  VALUES
    (:locationId, :name, :nameEn, :locationType, :promptBase, :description)
`;

export const UPDATE_LOCATION_TYPE = `
  UPDATE locations
     SET location_type = :locationType
   WHERE location_id = :locationId
`;

export const UPDATE_BLENDER_SCRIPT = `
  UPDATE locations
  SET blender_script = :blenderScript
  WHERE location_id = :locationId
`;

export const DELETE_LOCATION = `DELETE FROM locations WHERE location_id = :locationId`;
export const DELETE_LOC_CANDIDATES = `DELETE FROM location_candidates WHERE location_id = :locationId`;
export const DELETE_LOC_REF_IMAGES = `DELETE FROM location_ref_images WHERE location_id = :locationId`;

// ─── 행 타입 ────────────────────────────────────────────

export interface LocationRow {
  LOCATION_ID: string;
  NAME: string;
  NAME_EN: string | null;
  REGION_ID: string | null;
  LOCATION_TYPE: string | null;
  PROMPT_BASE: string | null;
  DESCRIPTION: string | null;
  FIRST_EP: number | null;
  CREATED_AT: Date;
}

// ─── 쿼리 함수 ──────────────────────────────────────────

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT } as const;

export async function listLocations(conn: oracledb.Connection): Promise<LocationRow[]> {
  const result = await conn.execute<LocationRow>(LIST_LOCATIONS, {}, OBJ);
  logger.debug('장소 목록 조회', { count: result.rows?.length ?? 0 });
  return result.rows ?? [];
}

export async function findLocationById(
  conn: oracledb.Connection,
  locationId: string,
): Promise<LocationRow | undefined> {
  const result = await conn.execute<LocationRow>(FIND_LOCATION_BY_ID, { locationId }, OBJ);
  return result.rows?.[0];
}

export async function insertLocation(
  conn: oracledb.Connection,
  data: {
    locationId: string;
    name: string;
    nameEn: string | null;
    locationType: string | null;
    promptBase: string | null;
    description: string | null;
  },
): Promise<void> {
  await conn.execute(INSERT_LOCATION, data as unknown as Record<string, unknown>, {
    autoCommit: true,
  });
  logger.info('장소 생성', { locationId: data.locationId, name: data.name });
}

export async function deleteLocation(conn: oracledb.Connection, locationId: string): Promise<void> {
  await conn.execute(DELETE_LOC_REF_IMAGES, { locationId }, { autoCommit: false });
  await conn.execute(DELETE_LOC_CANDIDATES, { locationId }, { autoCommit: false });
  await conn.execute(DELETE_LOCATION, { locationId }, { autoCommit: true });
  logger.info('장소 삭제', { locationId });
}

export async function updateBlenderScript(
  conn: oracledb.Connection,
  locationId: string,
  blenderScript: string,
): Promise<void> {
  await conn.execute(UPDATE_BLENDER_SCRIPT, { locationId, blenderScript }, { autoCommit: true });
}
