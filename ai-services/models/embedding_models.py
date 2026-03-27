"""
@module 임베딩 모델
@description 이미지/텍스트 임베딩 요청/응답에 사용되는 Pydantic 모델을 정의한다.

+-----------------+     +-----------------+
| EmbeddingReq    | --> | EmbeddingRes    |
| (path or text)  |     | (vector, dim)   |
+-----------------+     +-----------------+

@dependencies pydantic
"""

from pydantic import BaseModel, Field


class ImageEmbeddingRequest(BaseModel):
    """이미지 임베딩 요청 모델."""

    image_path: str = Field(..., description="임베딩할 이미지 경로")


class TextEmbeddingRequest(BaseModel):
    """텍스트 임베딩 요청 모델."""

    text: str = Field(..., description="임베딩할 텍스트")


class EmbeddingResponse(BaseModel):
    """임베딩 응답 모델."""

    embedding: list[float] = Field(..., description="임베딩 벡터")
    dimension: int = Field(..., description="벡터 차원 수")


class FaceCompareRequest(BaseModel):
    """얼굴 유사도 비교 요청 모델."""

    anchor_path: str = Field(..., description="앵커(기준) 이미지 경로")
    image_paths: list[str] = Field(..., description="비교 대상 이미지 경로 리스트")
    threshold: float = Field(default=0.4, description="유사 판정 거리 기준 (작을수록 엄격)")


class FaceCompareResult(BaseModel):
    """개별 이미지 비교 결과."""

    path: str
    distance: float
    similar: bool
    has_face: bool


class FaceCompareResponse(BaseModel):
    """얼굴 유사도 비교 응답 모델."""

    results: list[FaceCompareResult]
    similar_count: int
    total_count: int
