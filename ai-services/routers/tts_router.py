"""
@module TTS 라우터
@description 음성 합성 엔드포인트를 제공한다.

+-----------+     +-----------+
| POST /    | --> | TTS       |
| /generate |     | Response  |
+-----------+     +-----------+

@dependencies fastapi
"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()


class TtsGenerateRequest(BaseModel):
    """TTS 생성 요청 모델."""

    text: str = Field(..., description="합성할 텍스트")
    character: str = Field("default", description="캐릭터 음성 ID")


@router.post("/generate", status_code=501)
async def generate_tts(request: TtsGenerateRequest) -> JSONResponse:
    """TTS 음성 합성 (미구현)."""
    logger.info("TTS requested for character: %s", request.character)
    return JSONResponse(
        status_code=501,
        content={"detail": "TTS generation not implemented yet"},
    )
