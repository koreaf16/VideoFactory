"""
@module 헬스 체크 라우터
@description 서비스 상태 확인 엔드포인트를 제공한다.

+-----------+     +-----------+
| GET /     | --> | Health    |
| /health   |     | Response  |
+-----------+     +-----------+

@dependencies fastapi, pydantic
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


class ServiceStatus(BaseModel):
    """개별 서비스 상태."""

    oracle: bool = Field(..., description="Oracle DB 연결 상태")
    claude: bool = Field(..., description="Anthropic API 키 설정 여부")
    models_loaded: bool = Field(False, description="ML 모델 로드 여부")


class HealthResponse(BaseModel):
    """헬스 체크 응답 모델."""

    status: str = Field("ok", description="전체 상태")
    version: str = Field("0.1.0", description="API 버전")
    services: ServiceStatus


@router.get("", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """서비스 헬스 체크를 수행한다."""
    oracle_ok = False
    try:
        from db.oracle_connection import get_connection

        async with get_connection() as conn:
            cursor = await conn.cursor()
            await cursor.execute("SELECT 1 FROM DUAL")
            oracle_ok = True
    except Exception:
        logger.debug("Oracle health check failed")

    claude_ok = bool(settings.anthropic_api_key)

    return HealthResponse(
        status="ok",
        version="0.1.0",
        services=ServiceStatus(
            oracle=oracle_ok,
            claude=claude_ok,
            models_loaded=False,
        ),
    )
