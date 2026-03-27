"""
@module 스크립트 라우터
@description 대본 생성 엔드포인트를 제공한다.

+-----------+     +-----------+
| POST /    | --> | Script    |
| /generate |     | Response  |
+-----------+     +-----------+

@dependencies fastapi
"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from models.script_models import ScriptGenerateRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/generate", status_code=501)
async def generate_script(request: ScriptGenerateRequest) -> JSONResponse:
    """대본 생성 (미구현)."""
    logger.info("Script generate requested for ep %d", request.ep_number)
    return JSONResponse(
        status_code=501,
        content={"detail": "Script generation not implemented yet"},
    )
