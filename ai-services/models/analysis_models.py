"""
@module 분석 모델
@description 댓글 감성 분석 요청/응답에 사용되는 Pydantic 모델을 정의한다.

+-----------------+     +-----------------+
| AnalysisRequest | --> | SentimentResp   |
| (comments, ep)  |     | (pos, neg, neu) |
+-----------------+     +-----------------+

@dependencies pydantic
"""

from pydantic import BaseModel, Field


class AnalysisRequest(BaseModel):
    """댓글 분석 요청 모델."""

    comments: list[str] = Field(..., description="분석할 댓글 목록")
    ep_id: int | None = Field(None, description="에피소드 ID")


class SentimentResponse(BaseModel):
    """감성 분석 응답 모델."""

    positive: float = Field(..., description="긍정 비율 (0.0 ~ 1.0)")
    negative: float = Field(..., description="부정 비율 (0.0 ~ 1.0)")
    neutral: float = Field(..., description="중립 비율 (0.0 ~ 1.0)")
    clusters: list[dict[str, str | int]] | None = Field(
        None, description="주제 클러스터 목록"
    )
