/**
 * @module Oracle 커넥션 풀 관리자
 * @description oracledb npm 패키지를 이용해 Oracle 26ai 커넥션 풀을 생성하고 관리한다.
 *              앱 시작 시 initPool()로 풀 생성, 종료 시 closePool()로 정리한다.
 *
 * ┌──────────┐     ┌──────────────┐     ┌──────────┐
 * │  config  │ ──→ │  oracledb    │ ──→ │  Pool    │
 * │ (Oracle) │     │  initClient  │     │ (커넥션) │
 * └──────────┘     └──────────────┘     └──────────┘
 *       │                                     │
 *       └── user, password, dsn ──────────────┘
 *
 * @dependencies oracledb, config
 * @author AI Video Factory
 */

import oracledb from 'oracledb';
import { config } from '../config';
import { logger } from '../common/logger';

// CLOB → String 자동 변환 (모듈 로드 시 1회)
oracledb.fetchTypeHandler = function (
  metaData: oracledb.Metadata,
): oracledb.FetchTypeResponse | undefined {
  if (metaData.dbType === oracledb.DB_TYPE_CLOB) {
    return { type: oracledb.STRING };
  }
  return undefined;
};

// Oracle Instant Client 초기화 (모듈 로드 시 1회)
try {
  oracledb.initOracleClient({ libDir: config.oracle.instantClientPath });
  logger.info('Oracle Instant Client 초기화 완료', {
    libDir: config.oracle.instantClientPath,
  });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Oracle Instant Client 초기화 실패', { error: message });
}

let pool: oracledb.Pool | null = null;

/**
 * 커넥션 풀을 생성한다.
 * 앱 시작 시 한 번만 호출해야 한다.
 */
export async function initPool(): Promise<void> {
  if (pool) {
    logger.warn('커넥션 풀이 이미 생성되어 있습니다.');
    return;
  }

  try {
    pool = await oracledb.createPool({
      user: config.oracle.user,
      password: config.oracle.password,
      connectString: config.oracle.dsn,
      poolMin: config.oracle.poolMin,
      poolMax: config.oracle.poolMax,
      poolIncrement: 1,
    });
    logger.info('Oracle 커넥션 풀 생성 완료', {
      dsn: config.oracle.dsn,
      poolMin: config.oracle.poolMin,
      poolMax: config.oracle.poolMax,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Oracle 커넥션 풀 생성 실패', { error: message });
    throw err;
  }
}

/**
 * 풀에서 커넥션 하나를 가져온다.
 * 사용 후 반드시 connection.close()로 반환해야 한다.
 */
export async function getConnection(): Promise<oracledb.Connection> {
  if (!pool) {
    throw new Error('커넥션 풀이 초기화되지 않았습니다. initPool()을 먼저 호출하세요.');
  }

  try {
    const conn = await pool.getConnection();
    return conn;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('커넥션 획득 실패', { error: message });
    throw err;
  }
}

/**
 * 커넥션 풀을 종료한다.
 * 앱 종료(graceful shutdown) 시 호출한다.
 */
export async function closePool(): Promise<void> {
  if (!pool) {
    logger.warn('종료할 커넥션 풀이 없습니다.');
    return;
  }

  try {
    await pool.close(10); // 10초 대기 후 강제 종료
    pool = null;
    logger.info('Oracle 커넥션 풀 종료 완료');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Oracle 커넥션 풀 종료 실패', { error: message });
    throw err;
  }
}
