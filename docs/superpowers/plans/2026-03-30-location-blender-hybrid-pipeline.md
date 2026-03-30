# Location Blender Hybrid Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing img2img location pipeline with a 2-Phase Blender 3D + ComfyUI ControlNet hybrid pipeline for structurally consistent multi-angle location rendering.

**Architecture:** Phase 1 generates a 3D skeleton via Claude CLI → Blender headless, producing depth/normal maps. Phase 2 uses those maps with ComfyUI ControlNet + IP-Adapter to render textured images with consistent structure across all camera angles. The pipeline reuses the existing SSE streaming, job management, and LoRA training patterns.

**Tech Stack:** Node.js/TypeScript (Express), Python/FastAPI (Claude CLI subprocess), Blender CLI (headless bpy), ComfyUI (ControlNet Union + IP-Adapter), Oracle 26ai, vitest

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/locations/templates/blender-prompt.ts` | Camera angle constants, Claude CLI system prompt template |
| `src/locations/services/blender-script-generator.ts` | Call Python API to generate bpy script via Claude CLI |
| `src/locations/services/blender-renderer.ts` | Execute Blender CLI headless, validate output |
| `src/comfyui/workflows/controlnet-workflows.ts` | ControlNet Depth+Normal and IP-Adapter workflow builders |
| `src/web/views/locations/blender-preview.ejs` | Phase 1 depth map preview + confirm UI |
| `ai-services/routers/blender_router.py` | FastAPI endpoint wrapping Claude CLI subprocess |
| `ai-services/models/blender_models.py` | Pydantic request/response models |
| `tests/comfyui/controlnet-workflows.test.ts` | Workflow builder unit tests |
| `tests/locations/blender-prompt.test.ts` | Camera angle + prompt template tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/db/schema.sql` | Add `blender_script CLOB` column to `locations` |
| `src/db/queries/location-queries.ts` | Add blender_script update query |
| `src/locations/services/location-presets.ts` | Replace promptSuffix with cameraId mapping |
| `src/locations/services/location-candidate-generator.ts` | Replace txt2img with ControlNet depth candidate workflow |
| `src/locations/services/location-derivative-generator.ts` | Replace img2img with ControlNet + IP-Adapter workflow |
| `src/locations/routes/location-routes.ts` | Add Phase 1 skeleton endpoints |
| `src/locations/routes/location-derivative-routes.ts` | Update regeneration to use ControlNet |
| `src/web/views/locations/manage.ejs` | Enhanced form + Phase 1 trigger |
| `ai-services/main.py` | Register blender_router |
| `.env.example` | Add BLENDER_PATH |

---

## Task 1: Camera Angle Constants + Blender Prompt Template

**Files:**
- Create: `src/locations/templates/blender-prompt.ts`
- Test: `tests/locations/blender-prompt.test.ts`

- [ ] **Step 1: Write failing tests for camera angles and prompt builder**

```typescript
// tests/locations/blender-prompt.test.ts
import { describe, it, expect } from 'vitest';
import {
  CAMERA_ANGLES,
  buildBlenderSystemPrompt,
} from '../../src/locations/templates/blender-prompt';

describe('CAMERA_ANGLES', () => {
  it('has 12 camera angle definitions', () => {
    expect(CAMERA_ANGLES).toHaveLength(12);
  });

  it('each angle has id, label, and blender position hint', () => {
    for (const cam of CAMERA_ANGLES) {
      expect(cam).toHaveProperty('id');
      expect(cam).toHaveProperty('label');
      expect(cam).toHaveProperty('positionHint');
      expect(typeof cam.id).toBe('string');
      expect(typeof cam.label).toBe('string');
      expect(typeof cam.positionHint).toBe('string');
    }
  });

  it('first camera is front view', () => {
    expect(CAMERA_ANGLES[0].id).toBe('cam01_front');
  });

  it('has no duplicate ids', () => {
    const ids = CAMERA_ANGLES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildBlenderSystemPrompt', () => {
  it('includes output paths in prompt', () => {
    const prompt = buildBlenderSystemPrompt({
      depthDir: '/out/depth',
      normalDir: '/out/normal',
      resolution: 1024,
    });
    expect(prompt).toContain('/out/depth');
    expect(prompt).toContain('/out/normal');
    expect(prompt).toContain('1024');
  });

  it('includes camera count instruction', () => {
    const prompt = buildBlenderSystemPrompt({
      depthDir: '/d',
      normalDir: '/n',
      resolution: 1024,
    });
    expect(prompt).toContain('12');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/locations/blender-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement blender-prompt.ts**

```typescript
// src/locations/templates/blender-prompt.ts
/**
 * @module 블렌더 프롬프트 템플��
 * @description Claude CLI에 전달할 bpy 스크립트 생성 시스템 프롬프트와 카메라 앵글 상수를 정의한다.
 *
 * ┌──────────────┐     ┌──────────┐     ┌──────────┐
 * │ CAMERA_ANGLES│ ──→ │ System   │ ──→ │ Claude   │
 * │  (12 앵글)   │     │ Prompt   │     │ CLI      │
 * └��─────────────┘     └──────────┘     └──────────┘
 *
 * @dependencies none (pure data)
 * @author AI Video Factory
 */

export interface CameraAngle {
  readonly id: string;
  readonly label: string;
  readonly positionHint: string;
}

export const CAMERA_ANGLES: readonly CameraAngle[] = [
  { id: 'cam01_front', label: '정면 전체', positionHint: 'Front wall center, eye height, facing the main feature (e.g. chalkboard). Wide angle.' },
  { id: 'cam02_left45', label: '좌측 45도', positionHint: 'Rotated 45 degrees left from front, eye height.' },
  { id: 'cam03_right45', label: '���측 45도', positionHint: 'Rotated 45 degrees right from front, eye height.' },
  { id: 'cam04_reverse', label: '역방향', positionHint: '180 degrees from front, looking back toward entrance/door.' },
  { id: 'cam05_diagonal', label: '대각선', positionHint: 'Corner-to-corner diagonal, capturing maximum depth.' },
  { id: 'cam06_high', label: '하이 앵글', positionHint: 'Elevated position near ceiling, angled 45 degrees downward.' },
  { id: 'cam07_low_up', label: '로우 앵글 (올려다봄)', positionHint: 'Near floor level, angled upward toward ceiling.' },
  { id: 'cam08_low', label: '낮은 앵글', positionHint: 'Ground level, horizontal view along the floor.' },
  { id: 'cam09_closeup_a', label: '클로즈업 A', positionHint: 'Close to the main feature wall (e.g. chalkboard/window side).' },
  { id: 'cam10_closeup_b', label: '클로즈업 B', positionHint: 'Close to the secondary feature (e.g. opposite wall, bookshelf).' },
  { id: 'cam11_closeup_c', label: '클로즈업 C', positionHint: 'Close to furniture cluster or central element.' },
  { id: 'cam12_closeup_d', label: '클로즈업 D', positionHint: 'Close to entrance/door area.' },
] as const;

export interface BlenderPromptOptions {
  readonly depthDir: string;
  readonly normalDir: string;
  readonly resolution: number;
}

export function buildBlenderSystemPrompt(opts: BlenderPromptOptions): string {
  const cameraList = CAMERA_ANGLES.map(
    (c, i) => `  ${i + 1}. "${c.id}" — ${c.positionHint}`,
  ).join('\n');

  return `You are a Blender Python (bpy) script generator.
Generate a COMPLETE bpy script that:

1. Clears the default scene.
2. Creates the room/space using ONLY primitive shapes (cubes, cylinders, planes).
   - Use exact dimensions from the user's description.
   - Place furniture and objects as described.
   - DO NOT add materials, textures, or colors — geometry only.
3. Places exactly 12 cameras at these positions:
${cameraList}
4. For each camera, renders TWO passes at ${opts.resolution}x${opts.resolution} resolution:
   - Depth Map → save to: ${opts.depthDir}/{camera_id}.png
   - Normal Map → save to: ${opts.normalDir}/{camera_id}.png
5. Uses EEVEE engine (fast, no GPU required).
6. Uses Compositor nodes for depth/normal extraction.
7. Ensures all output directories exist (os.makedirs with exist_ok=True).

Output ONLY the Python script, no explanation. The script must be runnable as:
  blender --background --python script.py

Camera naming must exactly match the IDs above (cam01_front, cam02_left45, etc).
Depth maps: black = near, white = far. Normalized to 0-1 range.
Normal maps: RGB encoded world-space normals.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/locations/blender-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/locations/templates/blender-prompt.ts tests/locations/blender-prompt.test.ts
git commit -m "feat: add camera angle constants and Blender prompt template"
```

---

## Task 2: DB Schema — Add blender_script Column

**Files:**
- Modify: `src/db/schema.sql`
- Create: `src/db/migrations/003_add_blender_script.sql`
- Modify: `src/db/queries/location-queries.ts`

- [ ] **Step 1: Add blender_script column to schema.sql**

In `src/db/schema.sql`, add to the `locations` table definition after `description`:

```sql
  blender_script    CLOB,                 -- bpy 스크립트 원본 (재현/수정용)
```

- [ ] **Step 2: Create migration script**

```sql
-- src/db/migrations/003_add_blender_script.sql
ALTER TABLE locations ADD (
  blender_script CLOB
);
COMMENT ON COLUMN locations.blender_script IS 'Blender bpy script for 3D skeleton generation (Phase 1)';
```

- [ ] **Step 3: Add update query to location-queries.ts**

Add to `src/db/queries/location-queries.ts`:

```typescript
export const UPDATE_BLENDER_SCRIPT = `
  UPDATE locations
  SET blender_script = :blenderScript
  WHERE location_id = :locationId
`;

export async function updateBlenderScript(
  conn: oracledb.Connection,
  locationId: string,
  blenderScript: string,
): Promise<void> {
  await conn.execute(UPDATE_BLENDER_SCRIPT, { locationId, blenderScript }, { autoCommit: true });
}
```

- [ ] **Step 4: Run migration**

```bash
npx ts-node scripts/run-migration.ts src/db/migrations/003_add_blender_script.sql
```

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/queries/location-queries.ts src/db/migrations/003_add_blender_script.sql
git commit -m "feat: add blender_script CLOB column to locations table"
```

---

## Task 3: Python FastAPI — Blender Router

**Files:**
- Create: `ai-services/models/blender_models.py`
- Create: `ai-services/routers/blender_router.py`
- Modify: `ai-services/main.py`

- [ ] **Step 1: Create Pydantic models**

```python
# ai-services/models/blender_models.py
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
```

- [ ] **Step 2: Create blender router with Claude CLI subprocess**

```python
# ai-services/routers/blender_router.py
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
        raise HTTPException(status_code=504, detail="Claude CLI 타임아웃 (120초)")
    except FileNotFoundError:
        logger.error("Claude CLI를 찾을 수 없습니다. PATH 확인 필요.")
        raise HTTPException(status_code=500, detail="Claude CLI not found in PATH")
    except Exception as e:
        logger.error("블렌더 스크립트 생성 실패: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 3: Register router in main.py**

Add to `ai-services/main.py` imports:

```python
from routers import blender_router
```

Add to router registrations (after existing routers):

```python
app.include_router(blender_router.router, prefix="/api/blender", tags=["blender"])
```

- [ ] **Step 4: Verify Python module loads**

```bash
cd ai-services && python -c "from routers.blender_router import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add ai-services/models/blender_models.py ai-services/routers/blender_router.py ai-services/main.py
git commit -m "feat: add FastAPI blender router with Claude CLI subprocess"
```

---

## Task 4: Blender Script Generator Service (Node.js)

**Files:**
- Create: `src/locations/services/blender-script-generator.ts`

Depends on: Task 1, 2, 3

- [ ] **Step 1: Implement blender-script-generator.ts**

```typescript
// src/locations/services/blender-script-generator.ts
/**
 * @module 블렌더 스크립트 생성 서비스
 * @description Python FastAPI를 경유하여 Claude CLI로 bpy 스크립트를 생성하고 저장한다.
 *
 * ┌──────────┐     ┌───────────��     ┌──────────┐
 * │ Node.js  ��� ──→ │ Python    │ ──→ │ Claude   │
 * │ Service  │     │ FastAPI   │     │ CLI      │
 * └─���────────┘     └───────────┘     └──────────┘
 *        ↓                                 ↓
 *   Oracle DB                        bpy 스크립트
 *  (blender_script)                  (setup.py)
 *
 * @dependencies blender-prompt, location-queries, config
 * @author AI Video Factory
 */

import path from 'node:path';

import { config } from '../../common/config';
import { logger } from '../../common/logger';
import { ensureDir, writeFileBuffer } from '../../common/fs-helpers';
import { getConnection } from '../../db/connection';
import { updateBlenderScript } from '../../db/queries/location-queries';
import { buildBlenderSystemPrompt, CAMERA_ANGLES } from '../templates/blender-prompt';

const UPLOADS_BASE = path.resolve('uploads/locations');

export interface ScriptGenerationResult {
  readonly scriptPath: string;
  readonly cameraCount: number;
}

export async function generateAndSaveBlenderScript(
  locationId: string,
  description: string,
): Promise<ScriptGenerationResult> {
  const locDir = path.join(UPLOADS_BASE, locationId);
  const blenderDir = path.join(locDir, 'blender');
  const depthDir = path.join(locDir, 'depth_maps');
  const normalDir = path.join(locDir, 'normal_maps');
  await ensureDir(blenderDir);
  await ensureDir(depthDir);
  await ensureDir(normalDir);

  const systemPrompt = buildBlenderSystemPrompt({ depthDir, normalDir, resolution: 1024 });

  logger.info('블렌더 스크립트 생성 요청', { locationId });
  const resp = await fetch(`${config.pythonApi.baseUrl}/api/blender/generate-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, system_prompt: systemPrompt }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`블렌더 스크립트 생성 실패 (${resp.status}): ${errBody}`);
  }

  const { script } = (await resp.json()) as { script: string; success: boolean };
  const scriptPath = path.join(blenderDir, 'setup.py');
  await writeFileBuffer(scriptPath, Buffer.from(script, 'utf-8'));
  logger.info('bpy 스크립트 저장 완료', { scriptPath });

  const conn = await getConnection();
  try {
    await updateBlenderScript(conn, locationId, script);
  } finally {
    await conn.close();
  }

  return { scriptPath, cameraCount: CAMERA_ANGLES.length };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/services/blender-script-generator.ts
git commit -m "feat: add blender script generator service (Node.js → Python API)"
```

---

## Task 5: Blender Renderer Service

**Files:**
- Create: `src/locations/services/blender-renderer.ts`

Depends on: Task 1

- [ ] **Step 1: Implement blender-renderer.ts**

Note: Uses `spawn` with argument array (not `exec` with string) — safe against shell injection. This is the same pattern used for FFmpeg in this codebase.

```typescript
// src/locations/services/blender-renderer.ts
/**
 * @module 블렌더 렌더러 서비스
 * @description Blender CLI headless를 실행하여 depth/normal map을 렌더링하고 결과를 검증한다.
 *
 * ┌──────────��     ┌───────────┐     ┌──────────────┐
 * │ setup.py │ ──→ │ Blender   │ ─��→ │ depth_maps/  │
 * �� (bpy)    │     │ CLI       │     │ normal_maps/ ���
 * └──────────┘     └───────────┘     └──────────────┘
 *
 * @dependencies child_process(spawn), sharp, CAMERA_ANGLES
 * @author AI Video Factory
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { logger } from '../../common/logger';
import { CAMERA_ANGLES } from '../templates/blender-prompt';

const UPLOADS_BASE = path.resolve('uploads/locations');
const BLENDER_CMD = process.env.BLENDER_PATH ?? 'blender';

export interface RenderResult {
  readonly depthMaps: string[];
  readonly normalMaps: string[];
  readonly cameraCount: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly depthCount: number;
  readonly normalCount: number;
}

export async function renderMaps(locationId: string, scriptPath: string): Promise<RenderResult> {
  logger.info('블렌더 렌더링 시작', { locationId, scriptPath });

  return new Promise<RenderResult>((resolve, reject) => {
    const proc = spawn(BLENDER_CMD, ['--background', '--python', scriptPath], {
      cwd: path.dirname(scriptPath),
      timeout: 300_000,
    });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.error('블렌더 렌더링 실패', { code, stderr: stderr.slice(-500) });
        reject(new Error(`Blender exited with code ${code}: ${stderr.slice(-200)}`));
        return;
      }
      logger.info('블렌더 렌더링 완료', { locationId });
      const { depthMaps, normalMaps } = getMapPaths(locationId);
      resolve({ depthMaps, normalMaps, cameraCount: depthMaps.length });
    });

    proc.on('error', (err) => {
      reject(new Error(`블렌더 실행 실패: ${err.message}`));
    });
  });
}

export async function validateResults(locationId: string): Promise<ValidationResult> {
  const depthDir = path.join(UPLOADS_BASE, locationId, 'depth_maps');
  const normalDir = path.join(UPLOADS_BASE, locationId, 'normal_maps');
  const expectedCount = CAMERA_ANGLES.length;
  const errors: string[] = [];

  const depthFiles = fs.existsSync(depthDir)
    ? fs.readdirSync(depthDir).filter((f) => f.endsWith('.png'))
    : [];
  const normalFiles = fs.existsSync(normalDir)
    ? fs.readdirSync(normalDir).filter((f) => f.endsWith('.png'))
    : [];

  if (depthFiles.length !== expectedCount) {
    errors.push(`depth map ${depthFiles.length}장 (예상 ${expectedCount}장)`);
  }
  if (normalFiles.length !== expectedCount) {
    errors.push(`normal map ${normalFiles.length}장 (예상 ${expectedCount}장)`);
  }

  for (const file of depthFiles) {
    const meta = await sharp(path.join(depthDir, file)).metadata();
    if (meta.width !== 1024 || meta.height !== 1024) {
      errors.push(`${file}: ${meta.width}x${meta.height} (예상 1024x1024)`);
    }
  }

  return { valid: errors.length === 0, errors, depthCount: depthFiles.length, normalCount: normalFiles.length };
}

export function getMapPaths(locationId: string): { depthMaps: string[]; normalMaps: string[] } {
  const depthDir = path.join(UPLOADS_BASE, locationId, 'depth_maps');
  const normalDir = path.join(UPLOADS_BASE, locationId, 'normal_maps');

  const readPngs = (dir: string): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => path.join(dir, f)).sort()
      : [];

  return { depthMaps: readPngs(depthDir), normalMaps: readPngs(normalDir) };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/services/blender-renderer.ts
git commit -m "feat: add blender renderer service (CLI headless + validation)"
```

---

## Task 6: ControlNet Workflow Builders

**Files:**
- Create: `src/comfyui/workflows/controlnet-workflows.ts`
- Test: `tests/comfyui/controlnet-workflows.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/comfyui/controlnet-workflows.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildControlNetCandidateWorkflow,
  buildControlNetDerivativeWorkflow,
  CONTROLNET_DEFAULTS,
} from '../../src/comfyui/workflows/controlnet-workflows';

describe('buildControlNetCandidateWorkflow', () => {
  it('returns workflow with ControlNet nodes', () => {
    const wf = buildControlNetCandidateWorkflow({
      depthMapName: 'cam01_front.png',
      normalMapName: 'cam01_front.png',
      prompt: 'Japanese classroom, afternoon sunlight',
      seed: 12345,
    });
    const classTypes = Object.values(wf).map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('ControlNetLoader');
    expect(classTypes).toContain('ControlNetApplyAdvanced');
    expect(classTypes).toContain('KSampler');
    expect(classTypes).toContain('SaveImage');
  });

  it('loads depth map image', () => {
    const wf = buildControlNetCandidateWorkflow({
      depthMapName: 'cam01_front.png',
      normalMapName: 'cam01_front.png',
      prompt: 'test',
      seed: 1,
    });
    const loadNodes = Object.values(wf).filter(
      (n) => (n as { class_type: string }).class_type === 'LoadImage',
    ) as { inputs: { image: string } }[];
    const imageNames = loadNodes.map((n) => n.inputs.image);
    expect(imageNames).toContain('cam01_front.png');
  });

  it('applies custom seed to KSampler', () => {
    const wf = buildControlNetCandidateWorkflow({
      depthMapName: 'depth.png',
      normalMapName: 'normal.png',
      prompt: 'test',
      seed: 77777,
    });
    const sampler = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'KSampler',
    ) as { inputs: { seed: number } };
    expect(sampler.inputs.seed).toBe(77777);
  });
});

describe('buildControlNetDerivativeWorkflow', () => {
  it('includes IPAdapter node for style anchor', () => {
    const wf = buildControlNetDerivativeWorkflow({
      depthMapName: 'cam02_left45.png',
      normalMapName: 'cam02_left45.png',
      styleAnchorName: 'style_anchor.png',
      prompt: 'Japanese classroom',
      seed: 12345,
    });
    const classTypes = Object.values(wf).map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('IPAdapterAdvanced');
    expect(classTypes).toContain('CLIPVisionLoader');
  });

  it('loads style anchor image', () => {
    const wf = buildControlNetDerivativeWorkflow({
      depthMapName: 'depth.png',
      normalMapName: 'normal.png',
      styleAnchorName: 'my_anchor.png',
      prompt: 'test',
      seed: 1,
    });
    const loadNodes = Object.values(wf).filter(
      (n) => (n as { class_type: string }).class_type === 'LoadImage',
    ) as { inputs: { image: string } }[];
    const imageNames = loadNodes.map((n) => n.inputs.image);
    expect(imageNames).toContain('my_anchor.png');
  });

  it('patches model through IPAdapter before KSampler', () => {
    const wf = buildControlNetDerivativeWorkflow({
      depthMapName: 'd.png',
      normalMapName: 'n.png',
      styleAnchorName: 'a.png',
      prompt: 'test',
      seed: 1,
    });
    const sampler = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'KSampler',
    ) as { inputs: { model: [string, number] } };
    // Model should come from IPAdapter node (17), not directly from UNETLoader (1)
    expect(sampler.inputs.model[0]).toBe('17');
  });
});

describe('CONTROLNET_DEFAULTS', () => {
  it('has expected strength values', () => {
    expect(CONTROLNET_DEFAULTS.depthStrength).toBeGreaterThanOrEqual(0.7);
    expect(CONTROLNET_DEFAULTS.depthStrength).toBeLessThanOrEqual(0.9);
    expect(CONTROLNET_DEFAULTS.normalStrength).toBeGreaterThanOrEqual(0.3);
    expect(CONTROLNET_DEFAULTS.normalStrength).toBeLessThanOrEqual(0.5);
    expect(CONTROLNET_DEFAULTS.ipAdapterStrength).toBeGreaterThanOrEqual(0.4);
    expect(CONTROLNET_DEFAULTS.ipAdapterStrength).toBeLessThanOrEqual(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/comfyui/controlnet-workflows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement controlnet-workflows.ts**

```typescript
// src/comfyui/workflows/controlnet-workflows.ts
/**
 * @module ControlNet + IP-Adapter ComfyUI 워크플로우 빌더
 * @description 블렌더 depth/normal map을 사용한 ControlNet 기반 장소 이미지 생성 워크플로우.
 *
 * Candidate Node Graph (ControlNet only):
 *   [1] UNETLoader ──→ MODEL
 *   [2] DualCLIPLoader ──→ CLIP
 *   [3] VAELoader ──→ VAE
 *   [4] CLIPTextEncode ──→ [9] FluxGuidance
 *   [5] LoadImage(depth) ──→ [7] ControlNetApplyAdvanced
 *   [6] LoadImage(normal) ──→ [8] ControlNetApplyAdvanced
 *   [10] ControlNetLoader ──→ [7],[8]
 *   [7] → [8] → chained conditioning ──→ [11] KSampler
 *   [12] EmptyLatentImage ──→ [11]
 *   [11] ──→ [13] VAEDecode ──→ [14] SaveImage
 *
 * Derivative adds:
 *   [15] LoadImage(styleAnchor) ──→ [17] IPAdapterAdvanced
 *   [16] CLIPVisionLoader ──→ [17]
 *   [18] IPAdapterModelLoader ──→ [17]
 *   [17] patches MODEL ──→ [11] KSampler
 *
 * @dependencies comfyui.types, kontext-workflows (KONTEXT_DEFAULTS)
 * @author AI Video Factory
 */

import { logger } from '../../common/logger';
import type { ComfyUIWorkflow } from '../types/comfyui.types';
import { KONTEXT_DEFAULTS } from './kontext-workflows';

// ─── 기본값 ──────────────────────────────────────────

export const CONTROLNET_DEFAULTS = {
  controlnetModel: 'instantx-flux-controlnet-union.safetensors',
  ipAdapterModel: 'ip-adapter_flux.safetensors',
  clipVisionModel: 'clip-vit-large-patch14.safetensors',
  depthStrength: 0.8,
  normalStrength: 0.4,
  ipAdapterStrength: 0.45,
  steps: 28,
  guidance: 3.5,
  width: 1024,
  height: 1024,
  filenamePrefix: 'controlnet_loc',
} as const;

// ─── 인터페이스 ──────────────────────────────────────

export interface ControlNetCandidateOptions {
  readonly depthMapName: string;
  readonly normalMapName: string;
  readonly prompt: string;
  readonly seed: number;
  readonly depthStrength?: number;
  readonly normalStrength?: number;
  readonly width?: number;
  readonly height?: number;
  readonly filenamePrefix?: string;
}

export interface ControlNetDerivativeOptions extends ControlNetCandidateOptions {
  readonly styleAnchorName: string;
  readonly ipAdapterStrength?: number;
}

// ─── 공통 로더 ───────────────────────────────────────

function buildBaseLoaders(): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: KONTEXT_DEFAULTS.unetFluxDev, weight_dtype: 'default' } },
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: KONTEXT_DEFAULTS.clipL, clip_name2: KONTEXT_DEFAULTS.t5xxl, type: 'flux' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: KONTEXT_DEFAULTS.vae } },
  };
}

// ─── 후보 워크플로우 (ControlNet only) ────────────────

export function buildControlNetCandidateWorkflow(opts: ControlNetCandidateOptions): ComfyUIWorkflow {
  const w = opts.width ?? CONTROLNET_DEFAULTS.width;
  const h = opts.height ?? CONTROLNET_DEFAULTS.height;
  const dStr = opts.depthStrength ?? CONTROLNET_DEFAULTS.depthStrength;
  const nStr = opts.normalStrength ?? CONTROLNET_DEFAULTS.normalStrength;
  const prefix = opts.filenamePrefix ?? CONTROLNET_DEFAULTS.filenamePrefix;

  logger.debug('ControlNet 후보 워크플로우 생성', { seed: opts.seed, dStr, nStr });

  return {
    ...buildBaseLoaders(),
    '4': { class_type: 'CLIPTextEncode', inputs: { text: opts.prompt, clip: ['2', 0] } },
    '5': { class_type: 'LoadImage', inputs: { image: opts.depthMapName } },
    '6': { class_type: 'LoadImage', inputs: { image: opts.normalMapName } },
    '9': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: CONTROLNET_DEFAULTS.guidance } },
    '10': { class_type: 'ControlNetLoader', inputs: { control_net_name: CONTROLNET_DEFAULTS.controlnetModel } },
    '7': { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['9', 0], negative: ['9', 0], control_net: ['10', 0], image: ['5', 0], strength: dStr, start_percent: 0.0, end_percent: 1.0 } },
    '8': { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['7', 0], negative: ['7', 1], control_net: ['10', 0], image: ['6', 0], strength: nStr, start_percent: 0.0, end_percent: 1.0 } },
    '11': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['8', 0], negative: ['8', 1], latent_image: ['12', 0], seed: opts.seed, steps: CONTROLNET_DEFAULTS.steps, cfg: KONTEXT_DEFAULTS.cfg, sampler_name: KONTEXT_DEFAULTS.sampler, scheduler: KONTEXT_DEFAULTS.scheduler, denoise: 1.0 } },
    '12': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '13': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '14': { class_type: 'SaveImage', inputs: { images: ['13', 0], filename_prefix: prefix } },
  };
}

// ─── 파생 워크플로우 (ControlNet + IP-Adapter) ────────

export function buildControlNetDerivativeWorkflow(opts: ControlNetDerivativeOptions): ComfyUIWorkflow {
  const base = buildControlNetCandidateWorkflow(opts);
  const ipStr = opts.ipAdapterStrength ?? CONTROLNET_DEFAULTS.ipAdapterStrength;

  logger.debug('ControlNet + IP-Adapter 파생 워크플로우 생성', { seed: opts.seed, ipStr });

  return {
    ...base,
    '15': { class_type: 'LoadImage', inputs: { image: opts.styleAnchorName } },
    '16': { class_type: 'CLIPVisionLoader', inputs: { clip_name: CONTROLNET_DEFAULTS.clipVisionModel } },
    '18': { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: CONTROLNET_DEFAULTS.ipAdapterModel } },
    '17': { class_type: 'IPAdapterAdvanced', inputs: { model: ['1', 0], ipadapter: ['18', 0], clip_vision: ['16', 0], image: ['15', 0], weight: ipStr, weight_type: 'linear', start_at: 0.0, end_at: 1.0 } },
    '11': { ...(base['11']), inputs: { ...(base['11'] as { inputs: Record<string, unknown> }).inputs, model: ['17', 0] } },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/comfyui/controlnet-workflows.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/comfyui/workflows/controlnet-workflows.ts tests/comfyui/controlnet-workflows.test.ts
git commit -m "feat: add ControlNet + IP-Adapter workflow builders"
```

---

## Task 7: Update Location Presets (Camera ID Mapping)

**Files:**
- Modify: `src/locations/services/location-presets.ts`

Depends on: Task 1

- [ ] **Step 1: Rewrite location-presets.ts with cameraId mapping**

Replace entire file:

```typescript
// src/locations/services/location-presets.ts
/**
 * @module 장소 앵글 프리셋
 * @description 카메라 앵글 ID와 한국어 라벨, 재생성 힌트를 매핑한다.
 *
 * ┌──────────────┐     ┌────────────────┐
 * │ CAMERA_ANGLES│ ──→ │ LOCATION_PRESETS│
 * │  (template)  │     │  cameraId      │
 * └──────────────┘     │  angle, label  │
 *                      │  regenHint     │
 *                      └────────────────┘
 *
 * @dependencies blender-prompt
 * @author AI Video Factory
 */

import { CAMERA_ANGLES } from '../templates/blender-prompt';

export interface LocationPreset {
  readonly cameraId: string;
  readonly angle: string;
  readonly label: string;
  readonly regenHint: string;
}

export const LOCATION_PRESETS: readonly LocationPreset[] = [
  { cameraId: 'cam01_front', angle: 'front', label: '정면 전체', regenHint: 'wide angle front view, showing full room layout' },
  { cameraId: 'cam02_left45', angle: 'left45', label: '좌측 45도', regenHint: 'rotated 45 degrees left view' },
  { cameraId: 'cam03_right45', angle: 'right45', label: '우측 45도', regenHint: 'rotated 45 degrees right view' },
  { cameraId: 'cam04_reverse', angle: 'reverse', label: '역방향', regenHint: 'reverse view toward entrance' },
  { cameraId: 'cam05_diagonal', angle: 'diagonal', label: '대각선', regenHint: 'corner-to-corner diagonal view' },
  { cameraId: 'cam06_high', angle: 'high', label: '하이 앵글', regenHint: 'overhead high angle looking down' },
  { cameraId: 'cam07_low_up', angle: 'low_up', label: '로우 앵글', regenHint: 'low angle looking up toward ceiling' },
  { cameraId: 'cam08_low', angle: 'low', label: '낮은 앵글', regenHint: 'ground level horizontal view' },
  { cameraId: 'cam09_closeup_a', angle: 'closeup_a', label: '클로즈업 A', regenHint: 'close-up of main feature wall' },
  { cameraId: 'cam10_closeup_b', angle: 'closeup_b', label: '클로즈업 B', regenHint: 'close-up of secondary feature' },
  { cameraId: 'cam11_closeup_c', angle: 'closeup_c', label: '클로즈업 C', regenHint: 'close-up of furniture/central element' },
  { cameraId: 'cam12_closeup_d', angle: 'closeup_d', label: '클로즈업 D', regenHint: 'close-up of entrance/door area' },
] as const;

export function getPresetByCameraId(cameraId: string): LocationPreset | undefined {
  return LOCATION_PRESETS.find((p) => p.cameraId === cameraId);
}

export function getPresetByAngle(angle: string): LocationPreset | undefined {
  return LOCATION_PRESETS.find((p) => p.angle === angle);
}

if (LOCATION_PRESETS.length !== CAMERA_ANGLES.length) {
  throw new Error(`LOCATION_PRESETS(${LOCATION_PRESETS.length})와 CAMERA_ANGLES(${CAMERA_ANGLES.length}) 수 불일치`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/services/location-presets.ts
git commit -m "refactor: replace promptSuffix presets with cameraId mapping"
```

---

## Task 8: Modify Candidate Generator for ControlNet

**Files:**
- Modify: `src/locations/services/location-candidate-generator.ts`

Depends on: Task 5, 6

- [ ] **Step 1: Update imports and workflow call**

Replace the `buildKontextAnchorWorkflow` import with `buildControlNetCandidateWorkflow`. In `processOneLocCandidate`, replace the workflow construction:

```typescript
// Replace import:
// OLD: import { buildKontextAnchorWorkflow } from '../../comfyui/workflows/kontext-workflows';
// NEW:
import { buildControlNetCandidateWorkflow } from '../../comfyui/workflows/controlnet-workflows';
import { getMapPaths } from './blender-renderer';

// In processOneLocCandidate, replace workflow creation:
// Upload cam01 depth/normal map to ComfyUI
const { depthMaps, normalMaps } = getMapPaths(job.locationId);
if (depthMaps.length === 0) {
  throw new Error('depth map이 없습니다. Phase 1(뼈대 생성)을 먼저 실행하세요.');
}
await comfyuiClient.connect();
const depthName = await comfyuiClient.uploadImage(depthMaps[0]);
const normalName = normalMaps.length > 0
  ? await comfyuiClient.uploadImage(normalMaps[0])
  : depthName;

const workflow = buildControlNetCandidateWorkflow({
  depthMapName: depthName,
  normalMapName: normalName,
  prompt: promptItem.prompt,
  seed: promptItem.seed,
  width,
  height,
  filenamePrefix: `${job.locationId}_${promptItem.seed}`,
});
```

The rest of the function (submit workflow, download image, score, save to DB) stays identical.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/locations/services/location-candidate-generator.ts
git commit -m "feat: replace txt2img with ControlNet depth for location candidates"
```

---

## Task 9: Modify Derivative Generator for ControlNet + IP-Adapter

**Files:**
- Modify: `src/locations/services/location-derivative-generator.ts`

Depends on: Task 5, 6, 7

- [ ] **Step 1: Update imports and workflow**

Replace `buildFluxImg2ImgWorkflow` with `buildControlNetDerivativeWorkflow`. Replace `getLocationPresets(outdoor)` with `LOCATION_PRESETS`. Update `generateOneAngle` to upload camera-specific depth/normal maps:

```typescript
// Replace imports:
import { buildControlNetDerivativeWorkflow } from '../../comfyui/workflows/controlnet-workflows';
import { getMapPaths } from './blender-renderer';
import { LOCATION_PRESETS, type LocationPreset } from './location-presets';

// In startLocDerivativeGeneration:
// Replace: const presets = getLocationPresets(outdoor);
// With:    const presets = LOCATION_PRESETS;

// In generateOneAngle, replace workflow:
const { depthMaps, normalMaps } = getMapPaths(job.locationId);
const depthFile = depthMaps.find((f) => path.basename(f, '.png') === preset.cameraId);
const normalFile = normalMaps.find((f) => path.basename(f, '.png') === preset.cameraId);
if (!depthFile) throw new Error(`depth map 없음: ${preset.cameraId}`);

await comfyuiClient.connect();
const depthName = await comfyuiClient.uploadImage(depthFile);
const normalName = normalFile ? await comfyuiClient.uploadImage(normalFile) : depthName;
const anchorName = await comfyuiClient.uploadImage(job.anchorPath);

const workflow = buildControlNetDerivativeWorkflow({
  depthMapName: depthName,
  normalMapName: normalName,
  styleAnchorName: anchorName,
  prompt: job.promptBase,
  seed,
  filenamePrefix: `${job.locationId}_${preset.angle}_${seed}`,
});
```

- [ ] **Step 2: Remove outdoor detection logic**

Delete the `isOutdoorPrompt()` call and the outdoor/indoor branching — ControlNet depth maps make this unnecessary since structure comes from Blender, not prompts.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/locations/services/location-derivative-generator.ts
git commit -m "feat: replace img2img with ControlNet + IP-Adapter for location derivatives"
```

---

## Task 10: Phase 1 Routes + SSE Streaming

**Files:**
- Modify: `src/locations/routes/location-routes.ts`

Depends on: Task 4, 5

- [ ] **Step 1: Add Phase 1 skeleton endpoints**

Add to `location-routes.ts` the following routes: `POST /:locationId/generate-skeleton`, `GET /:locationId/skeleton-stream` (SSE), `GET /:locationId/skeleton-preview`. Also add `POST /:locationId/set-anchor` for saving style_anchor.png.

The skeleton job uses the same in-memory Map + EventEmitter + SSE pattern as derivatives. The `generate-skeleton` handler fires and forgets an async chain: script generation → blender rendering → validation.

The `set-anchor` endpoint copies the selected candidate image to `uploads/locations/{locationId}/style_anchor.png` and updates `location_type` to `'anchor_set'`.

See `location-derivative-routes.ts` SSE pattern (locDerivEvents, `res.writeHead` + `res.write`) for exact implementation reference.

- [ ] **Step 2: Commit**

```bash
git add src/locations/routes/location-routes.ts
git commit -m "feat: add Phase 1 skeleton + set-anchor routes with SSE"
```

---

## Task 11: Phase 1 Web UI (blender-preview.ejs)

**Files:**
- Create: `src/web/views/locations/blender-preview.ejs`

Depends on: Task 10

- [ ] **Step 1: Create blender-preview.ejs**

Follow the exact patterns from `derivatives.ejs`:
- SSE connection to `/:locationId/skeleton-stream`
- Progress bar with gradient
- Status icon with spinner → checkmark
- Depth map grid (4 columns) showing thumbnails with camera angle labels
- Two action buttons: "뼈대 확인 → Phase 2 진행" and "설명 수정 → 재생성"
- Use `pathToUrl()` from `characters.js` for image paths
- Use vanilla JS (no Alpine.js), IIFE wrapper, same Tailwind classes as other location pages

- [ ] **Step 2: Add web route to serve the page**

In the web routes file, add:

```typescript
router.get('/locations/blender-preview', (req, res) => {
  res.render('locations/blender-preview', { locationId: req.query.locationId });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/web/views/locations/blender-preview.ejs
git commit -m "feat: add Phase 1 blender preview web UI"
```

---

## Task 12: Update manage.ejs for Phase 1 Trigger

**Files:**
- Modify: `src/web/views/locations/manage.ejs`

Depends on: Task 10

- [ ] **Step 1: Add Phase 1 button for main-type locations**

In the card rendering function, add a "뼈대 생성" button for `main` type locations. On click: POST to `/api/locations/:locationId/generate-skeleton` with `{ description }` body, then redirect to `/locations/blender-preview?locationId=...`.

If `loc.DESCRIPTION` is empty, use `prompt()` to ask for it inline.

- [ ] **Step 2: Add description textarea to add-location modal**

Add a `<textarea>` for `description` (3D 공간 설명) in the registration modal, separate from the existing `promptBase` textarea.

- [ ] **Step 3: Commit**

```bash
git add src/web/views/locations/manage.ejs
git commit -m "feat: add Phase 1 skeleton trigger to location manage UI"
```

---

## Task 13: Update Derivative Routes for ControlNet Regeneration

**Files:**
- Modify: `src/locations/routes/location-derivative-routes.ts`

Depends on: Task 6, 7

- [ ] **Step 1: Update regeneration endpoint**

In the `/ref-images/:refId/regenerate` handler, replace `buildKontextEditWorkflow` with `buildControlNetDerivativeWorkflow`. Use `getPresetByAngle()` to find the preset, `getMapPaths()` to find the camera-specific depth/normal map, and upload `style_anchor.png` as the IP-Adapter reference.

```typescript
// Key changes in the handler:
import { buildControlNetDerivativeWorkflow } from '../../comfyui/workflows/controlnet-workflows';
import { getMapPaths } from '../services/blender-renderer';
import { getPresetByAngle } from '../services/location-presets';

// Find depth/normal for this angle's camera
const preset = getPresetByAngle(ref.ANGLE);
const { depthMaps, normalMaps } = getMapPaths(ref.LOCATION_ID);
const depthFile = depthMaps.find((f) => path.basename(f, '.png') === preset.cameraId);

// Upload all three images to ComfyUI
const depthName = await comfyuiClient.uploadImage(depthFile);
const normalName = normalFile ? await comfyuiClient.uploadImage(normalFile) : depthName;
const styleAnchorPath = path.join('uploads/locations', ref.LOCATION_ID, 'style_anchor.png');
const styleAnchorName = await comfyuiClient.uploadImage(styleAnchorPath);

// Build ControlNet workflow
const wf = buildControlNetDerivativeWorkflow({
  depthMapName: depthName,
  normalMapName: normalName,
  styleAnchorName,
  prompt: modifyPrompt ? `${promptBase}, ${preset.regenHint}, ${modifyPrompt}` : `${promptBase}, ${preset.regenHint}`,
  seed,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/locations/routes/location-derivative-routes.ts
git commit -m "feat: update derivative regeneration to use ControlNet + IP-Adapter"
```

---

## Task 14: Environment Variables + Setup Docs

**Files:**
- Modify: `.env.example`
- Create: `docs/setup/comfyui-controlnet-setup.md`

- [ ] **Step 1: Add BLENDER_PATH to .env.example**

```bash
# Blender CLI (headless rendering for location depth/normal maps)
BLENDER_PATH=blender
```

- [ ] **Step 2: Create ComfyUI setup guide**

Create `docs/setup/comfyui-controlnet-setup.md` with:
- Custom node installation instructions (comfyui_controlnet_aux, ComfyUI_IPAdapter_plus)
- Model download URLs (ControlNet Union, IP-Adapter, CLIP Vision)
- Verification steps
- Fallback plan (FLUX-only → SDXL)

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/setup/comfyui-controlnet-setup.md
git commit -m "docs: add Blender env var and ComfyUI ControlNet setup guide"
```

---

## Summary: Task Dependencies

```
Task 1 (camera angles)     ← no deps
Task 2 (DB schema)         ← no deps
Task 3 (Python router)     ← no deps
Task 6 (ControlNet wf)     ← no deps
Task 14 (env + docs)       ← no deps

Task 4 (script gen)        ← 1, 2, 3
Task 5 (blender renderer)  ← 1
Task 7 (update presets)    ← 1

Task 8 (candidate gen)     ← 5, 6
Task 9 (derivative gen)    ← 5, 6, 7
Task 10 (Phase 1 routes)   ← 4, 5
Task 13 (deriv routes)     ← 6, 7

Task 11 (blender-preview)  ← 10
Task 12 (manage.ejs)       ← 10

Parallel groups:
  Group A (no deps):    1, 2, 3, 6, 14
  Group B (after A):    4, 5, 7
  Group C (after B):    8, 9, 10, 13
  Group D (after C):    11, 12
```
