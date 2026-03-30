"""
@module FastAPI 메인 엔트리포인트
@description AI Services 서버를 구성하고 실행한다.

+-----------+     +-----------+     +-----------+
|  FastAPI  | --> |  Routers  | --> |  Oracle   |
|   app     |     | (5 modules)|    |   Pool    |
+-----------+     +-----------+     +-----------+

@dependencies fastapi, uvicorn
"""

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import (
    blender_router,
    embedding_router,
    health_router,
    quality_router,
    script_router,
    tts_router,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.DEBUG),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Video Factory - AI Services",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router.router, prefix="/api/health", tags=["health"])
app.include_router(script_router.router, prefix="/api/script", tags=["script"])
app.include_router(embedding_router.router, prefix="/api/embedding", tags=["embedding"])
app.include_router(tts_router.router, prefix="/api/tts", tags=["tts"])
app.include_router(quality_router.router, prefix="/api/quality", tags=["quality"])
app.include_router(blender_router.router, prefix="/api/blender", tags=["blender"])


@app.on_event("startup")
async def startup_event() -> None:
    """서버 시작 시 리소스를 초기화한다."""
    logger.info("Starting AI Services on %s:%d", settings.host, settings.port)
    try:
        from db.oracle_connection import init_pool

        await init_pool()
        logger.info("Oracle connection pool initialized")
    except Exception as exc:
        logger.warning("Oracle pool init failed — running without DB: %s", exc)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """서버 종료 시 리소스를 정리한다."""
    try:
        from db.oracle_connection import close_pool

        await close_pool()
        logger.info("Oracle connection pool closed")
    except Exception as exc:
        logger.warning("Oracle pool close failed: %s", exc)


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
