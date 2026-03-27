"""
@module Oracle DB 연결 관리
@description Oracle 커넥션 풀을 생성하고 연결을 제공한다.

+-----------+     +-----------+     +-----------+
| settings  | --> | oracledb  | --> |   pool    |
|  (DSN)    |     |  pool     |     | (2~10)    |
+-----------+     +-----------+     +-----------+

@dependencies python-oracledb
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import oracledb

from config import settings

logger = logging.getLogger(__name__)

_pool: oracledb.AsyncConnectionPool | None = None


async def init_pool() -> None:
    """Oracle 비동기 커넥션 풀을 초기화한다."""
    global _pool
    if _pool is not None:
        return

    oracledb.init_oracle_client(lib_dir=settings.oracle_instant_client_path)

    _pool = oracledb.create_pool_async(
        user=settings.oracle_user,
        password=settings.oracle_password,
        dsn=settings.oracle_dsn,
        min=2,
        max=10,
        increment=1,
    )
    logger.info("Oracle connection pool created (min=2, max=10)")


@asynccontextmanager
async def get_connection() -> AsyncGenerator[oracledb.AsyncConnection, None]:
    """풀에서 커넥션을 꺼내 사용 후 반환한다."""
    if _pool is None:
        raise RuntimeError("Oracle pool is not initialized. Call init_pool() first.")

    async with _pool.acquire() as conn:
        yield conn


async def close_pool() -> None:
    """Oracle 커넥션 풀을 종료한다."""
    global _pool
    if _pool is not None:
        await _pool.close(force=True)
        _pool = None
        logger.info("Oracle connection pool closed")
