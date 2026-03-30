"""
@module 블렌더 스크립트 생성 라우터
@description Claude CLI subprocess를 호출하여 bpy 스크립트를 생성하는 FastAPI 라우터.

┌──────────┐     ┌───────────┐     ┌──────────┐
│ Node.js  │ ──→ │ FastAPI   │ ──→ │ Claude   │
│ (HTTP)   │     │ (router)  │     │ CLI      │
└──────────┘     └───────────┘     └──────────┘

@dependencies asyncio.subprocess, models.blender_models
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from models.blender_models import GenerateScriptRequest, GenerateScriptResponse

logger = logging.getLogger(__name__)
router = APIRouter()


async def _run_claude_cli(system_prompt: str, user_prompt: str) -> str:
    """Claude CLI를 subprocess로 실행하여 응답을 반환한다."""
    cmd = ["claude", "-p", f"{system_prompt}\n\n{user_prompt}", "--no-input"]
    logger.info("Claude CLI 호출 시작 (prompt length=%d)", len(user_prompt))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        logger.error("Claude CLI 실패 (code=%d): %s", proc.returncode, err_msg)
        raise HTTPException(status_code=502, detail=f"Claude CLI failed: {err_msg}")

    return stdout.decode("utf-8", errors="replace").strip()


def _extract_python_block(raw: str) -> str:
    """Claude 응답에서 python 코드 블록을 추출한다."""
    if "```python" in raw:
        start = raw.index("```python") + len("```python")
        end = raw.index("```", start)
        return raw[start:end].strip()
    if "```" in raw:
        start = raw.index("```") + 3
        end = raw.index("```", start)
        return raw[start:end].strip()
    return raw


@router.post("/generate-script", response_model=GenerateScriptResponse)
async def generate_blender_script(req: GenerateScriptRequest) -> GenerateScriptResponse:
    """Claude CLI로 bpy 스크립트를 생성한다."""
    try:
        raw_output = await _run_claude_cli(req.system_prompt, req.description)
        script = _extract_python_block(raw_output)

        if "import bpy" not in script:
            raise HTTPException(
                status_code=422,
                detail="생성된 스크립트에 'import bpy'가 없습니다. 재시도해주세요.",
            )

        return GenerateScriptResponse(script=script)

    except HTTPException:
        raise
    except TimeoutError:
        logger.error("Claude CLI 타임아웃 (120초 초과)")
        raise HTTPException(status_code=504, detail="Claude CLI 타임아웃 (120초)") from None
    except FileNotFoundError:
        logger.error("Claude CLI를 찾을 수 없습니다. PATH 확인 필요.")
        raise HTTPException(status_code=500, detail="Claude CLI not found in PATH") from None
    except Exception as e:
        logger.error("블렌더 스크립트 생성 실패: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e)) from e
