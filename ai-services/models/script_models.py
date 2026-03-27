"""
@module 스크립트 모델
@description 대본 생성 요청/응답에 사용되는 Pydantic 모델을 정의한다.

+-----------------+     +-----------------+
| GenerateRequest | --> | GenerateResponse|
| (ep, type, ...) |     | (scenes, title) |
+-----------------+     +-----------------+

@dependencies pydantic
"""

from pydantic import BaseModel, Field


class ScriptGenerateRequest(BaseModel):
    """대본 생성 요청 모델."""

    ep_number: int = Field(..., description="에피소드 번호")
    ep_type: str = Field(..., description="에피소드 유형 (main / side)")
    characters: list[str] | None = Field(None, description="등장 캐릭터 목록")
    previous_episodes: list[int] | None = Field(None, description="참조할 이전 에피소드 번호 목록")


class DialogueLine(BaseModel):
    """대사 한 줄을 나타내는 모델."""

    character: str = Field(..., description="캐릭터 이름")
    line: str = Field(..., description="대사 내용")
    emotion: str | None = Field(None, description="감정 태그")


class SceneScript(BaseModel):
    """장면 하나를 나타내는 모델."""

    scene_order: int = Field(..., description="장면 순서")
    description: str = Field(..., description="장면 설명")
    location: str | None = Field(None, description="장면 장소")
    dialogues: list[DialogueLine] = Field(default_factory=list, description="대사 목록")


class ScriptGenerateResponse(BaseModel):
    """대본 생성 응답 모델."""

    ep_number: int = Field(..., description="에피소드 번호")
    title: str = Field(..., description="에피소드 제목")
    synopsis: str = Field(..., description="시놉시스")
    scenes: list[SceneScript] = Field(default_factory=list, description="장면 목록")
