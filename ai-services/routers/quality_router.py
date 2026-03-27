"""
@module 품질 평가 라우터
@description 이미지 품질 평가 엔드포인트를 제공한다.

+-----------+     +-----------+
| POST /    | --> | Quality   |
| /score-   |     | Response  |
|  image    |     |           |
+-----------+     +-----------+

@dependencies fastapi
"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from models.quality_models import ImageScoreRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/score-image", status_code=501)
async def score_image(request: ImageScoreRequest) -> JSONResponse:
    """이미지 품질 평가 (미구현)."""
    logger.info("Quality scoring requested: %s", request.image_path)
    return JSONResponse(
        status_code=501,
        content={"detail": "Image quality scoring not implemented yet"},
    )
