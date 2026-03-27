"""
@module 품질 평가 모델
@description 이미지 품질 평가 요청/응답에 사용되는 Pydantic 모델을 정의한다.

+-----------------+     +-----------------+
| ImageScoreReq   | --> | ImageScoreRes   |
| (path, ref_emb) |     | (score, grade)  |
+-----------------+     +-----------------+

@dependencies pydantic
"""

from pydantic import BaseModel, Field


class ImageScoreRequest(BaseModel):
    """이미지 품질 평가 요청 모델."""

    image_path: str = Field(..., description="평가할 이미지 경로")
    reference_embedding: list[float] | None = Field(
        None, description="참조 임베딩 벡터"
    )


class ImageScoreResponse(BaseModel):
    """이미지 품질 평가 응답 모델."""

    quality_score: float = Field(..., description="품질 점수 (0.0 ~ 1.0)")
    grade: str = Field(..., description="등급 (S / A / B / C / D)")
    face_detected: bool = Field(..., description="얼굴 감지 여부")
    details: dict[str, float] | None = Field(None, description="세부 점수 항목")
