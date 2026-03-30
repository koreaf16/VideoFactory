"""
@module 블렌더 스크립트 생성 요청/응답 모델
@description Claude CLI를 통한 bpy 스크립트 생성 API의 Pydantic 모델.

┌───────────────────┐     ┌───────────────────┐
│ GenerateScriptReq │ ──→ │ GenerateScriptRes │
│  description      │     │  script           │
│  system_prompt    │     │  success          │
└───────────────────┘     └───────────────────┘

@dependencies pydantic
"""

from pydantic import BaseModel, Field


class GenerateScriptRequest(BaseModel):
    """bpy 스크립트 생성 요청."""

    description: str = Field(..., description="장소 설명 (치수, 가구 배치)")
    system_prompt: str = Field(..., description="블렌더 스크립트 생성 시스템 프롬프트")


class GenerateScriptResponse(BaseModel):
    """bpy 스크립트 생성 응답."""

    script: str = Field(..., description="생성된 bpy Python 스크립트")
    success: bool = Field(default=True)
