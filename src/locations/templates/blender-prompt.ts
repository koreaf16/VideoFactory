/**
 * @module 블렌더 프롬프트 템플릿
 * @description Claude CLI에 전달할 bpy 스크립트 생성 시스템 프롬프트와 카메라 앵글 상수를 정의한다.
 *
 * ┌──────────────┐     ┌──────────┐     ┌──────────┐
 * │ CAMERA_ANGLES│ ──→ │ System   │ ──→ │ Claude   │
 * │  (12 앵글)   │     │ Prompt   │     │ CLI      │
 * └──────────────┘     └──────────┘     └──────────┘
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
  {
    id: 'cam01_front',
    label: '정면 전체',
    positionHint:
      'Place camera at eye level directly in front of the scene, facing forward along -Y axis.',
  },
  {
    id: 'cam02_left45',
    label: '좌측 45도',
    positionHint: 'Place camera at eye level 45 degrees to the left of center, facing the scene.',
  },
  {
    id: 'cam03_right45',
    label: '우측 45도',
    positionHint: 'Place camera at eye level 45 degrees to the right of center, facing the scene.',
  },
  {
    id: 'cam04_reverse',
    label: '역방향',
    positionHint:
      'Place camera at eye level behind the scene facing back toward the entrance (180 degrees reversed).',
  },
  {
    id: 'cam05_diagonal',
    label: '대각선',
    positionHint:
      'Place camera at eye level in the corner, aimed diagonally across to the opposite corner.',
  },
  {
    id: 'cam06_high',
    label: '하이 앵글',
    positionHint: "Place camera high above the scene (bird's-eye), pointing straight down.",
  },
  {
    id: 'cam07_low_up',
    label: '로우 앵글 (올려다봄)',
    positionHint: 'Place camera very low near the floor, tilted upward to look toward the ceiling.',
  },
  {
    id: 'cam08_low',
    label: '낮은 앵글',
    positionHint:
      'Place camera at floor level looking across the room horizontally at furniture legs and baseboards.',
  },
  {
    id: 'cam09_closeup_a',
    label: '클로즈업 A (main feature wall)',
    positionHint: 'Position camera close to the main feature wall, framing wall details tightly.',
  },
  {
    id: 'cam10_closeup_b',
    label: '클로즈업 B (secondary feature)',
    positionHint:
      'Position camera close to the secondary feature element (window, shelf, or accent piece).',
  },
  {
    id: 'cam11_closeup_c',
    label: '클로즈업 C (furniture/central)',
    positionHint:
      'Position camera close to the central furniture piece, showing material and form.',
  },
  {
    id: 'cam12_closeup_d',
    label: '클로즈업 D (entrance/door)',
    positionHint:
      'Position camera close to the entrance or doorway, framing the door frame and threshold.',
  },
] as const;

export interface BlenderPromptOptions {
  /** Absolute path where depth map renders will be saved */
  readonly depthDir: string;
  /** Absolute path where normal map renders will be saved */
  readonly normalDir: string;
  /** Render resolution in pixels (square) */
  readonly resolution: number;
}

/**
 * Builds the Claude CLI system prompt for generating a bpy (Blender Python) script.
 * The generated script creates a room scene, places 12 fixed cameras, and renders
 * depth and normal maps per camera using the EEVEE engine.
 */
export function buildBlenderSystemPrompt(opts: BlenderPromptOptions): string {
  const { depthDir, normalDir, resolution } = opts;

  const cameraList = CAMERA_ANGLES.map(
    (cam, i) => `  ${i + 1}. ${cam.id} — ${cam.label}: ${cam.positionHint}`,
  ).join('\n');

  return `You are an expert Blender Python (bpy) script generator.

Generate a complete, self-contained bpy script that does the following:

## Scene Setup
1. Clear the default Blender scene (delete all default objects).
2. Build a room using ONLY primitive shapes: cubes (bpy.ops.mesh.primitive_cube_add), cylinders (bpy.ops.mesh.primitive_cylinder_add), and planes (bpy.ops.mesh.primitive_plane_add). Do NOT import any external meshes or assets.
3. Set the render engine to EEVEE (bpy.context.scene.render.engine = 'BLENDER_EEVEE').
4. Set the render resolution to ${resolution}x${resolution} pixels.

## Cameras
Place exactly 12 cameras at the following positions. Use descriptive variable names matching the camera IDs:

${cameraList}

## Rendering — Depth Maps
For each of the 12 cameras:
- Switch to that camera.
- Configure the material override to render a depth pass (use a shader that outputs normalized depth as the final color, or use the compositor Z pass baked to color).
- Render and save the result to: ${depthDir}/<camera_id>.png
  (e.g., ${depthDir}/cam01_front.png)

## Rendering — Normal Maps
For each of the 12 cameras:
- Switch to that camera.
- Configure the material override to render a world-space normal pass (map XYZ normal vector to RGB).
- Render and save the result to: ${normalDir}/<camera_id>.png
  (e.g., ${normalDir}/cam01_front.png)

## Requirements
- Use EEVEE engine throughout (not Cycles).
- Output exactly 12 depth images to: ${depthDir}/
- Output exactly 12 normal images to: ${normalDir}/
- Total renders: 24 images (12 depth + 12 normal).
- Resolution: ${resolution}x${resolution} for all renders.
- The script must be runnable via: blender --background --python <script.py>
- Do NOT use interactive UI calls. Everything must work headless.
- Add a comment at the top of the script explaining what it does.

Generate ONLY the Python script. Do not include explanations outside the script itself.`;
}
