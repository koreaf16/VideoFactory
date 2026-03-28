/**
 * @module LoRA DB 헬퍼
 * @description LoRA 서비스에서 사용하는 공통 DB 유틸리티
 *
 * @dependencies db
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { getConnection } from '../../db/connection';

/** SQL 실행 (단일 커밋) */
export async function execSql(sql: string, binds: Record<string, unknown>): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(sql, binds);
    await conn.commit();
  } finally {
    await conn.close();
  }
}

/** 단일 행 조회 */
export async function queryOne<T>(sql: string, binds: Record<string, unknown>): Promise<T | null> {
  const conn = await getConnection();
  try {
    const r = await conn.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return r.rows?.[0] ?? null;
  } finally {
    await conn.close();
  }
}
