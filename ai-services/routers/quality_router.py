"""
@module 품질 평가 라우터
@description 이미지 품질 평가 엔드포인트를 제공한다.

+-----------+     +-------------+     +-----------+
| POST /    | --> | image_      | --> | Quality   |
| /score-   |     | scorer      |     | Response  |
|  image    |     | (score)     |     |           |
+-----------+     +-------------+     +-----------+

@dependencies fastapi, image_scorer
"""

import logging

from fastapi import APIRouter, HTTPException

from models.quality_models import ImageScoreRequest, ImageScoreResponse
from services.quality.image_scorer import score_image as _score_image

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/score-image", response_model=ImageScoreResponse)
async def score_image(request: ImageScoreRequest) -> ImageScoreResponse:
    """이미지 품질을 평가해 점수와 등급을 반환한다."""
    logger.info("품질 평가 요청: %s", request.image_path)

    try:
        result = _score_image(
            image_path=request.image_path,
            reference_embedding=request.reference_embedding,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("품질 평가 오류: %s", e)
        raise HTTPException(status_code=500, detail=f"품질 평가 실패: {e}")

    score = result["quality_score"]
    if score >= 0.9:
        grade = "S"
    elif score >= 0.8:
        grade = "A"
    elif score >= 0.7:
        grade = "B"
    elif score >= 0.5:
        grade = "C"
    else:
        grade = "D"

    return ImageScoreResponse(
        quality_score=score,
        grade=grade,
        face_detected=result["face_detected"],
        details=result.get("details"),
    )
