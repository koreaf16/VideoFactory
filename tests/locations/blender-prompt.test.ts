import { describe, it, expect } from 'vitest';
import {
  CAMERA_ANGLES,
  buildBlenderSystemPrompt,
} from '../../src/locations/templates/blender-prompt';
import type {
  CameraAngle,
  BlenderPromptOptions,
} from '../../src/locations/templates/blender-prompt';

describe('CAMERA_ANGLES', () => {
  it('has exactly 12 angles', () => {
    expect(CAMERA_ANGLES).toHaveLength(12);
  });

  it('first angle is cam01_front', () => {
    expect(CAMERA_ANGLES[0].id).toBe('cam01_front');
  });

  it('last angle is cam12_closeup_d', () => {
    expect(CAMERA_ANGLES[11].id).toBe('cam12_closeup_d');
  });

  it('has no duplicate ids', () => {
    const ids = CAMERA_ANGLES.map((a) => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('each angle has id, label, and positionHint', () => {
    for (const angle of CAMERA_ANGLES) {
      expect(typeof angle.id).toBe('string');
      expect(angle.id.length).toBeGreaterThan(0);
      expect(typeof angle.label).toBe('string');
      expect(angle.label.length).toBeGreaterThan(0);
      expect(typeof angle.positionHint).toBe('string');
      expect(angle.positionHint.length).toBeGreaterThan(0);
    }
  });

  it('contains all expected ids in order', () => {
    const expectedIds = [
      'cam01_front',
      'cam02_left45',
      'cam03_right45',
      'cam04_reverse',
      'cam05_diagonal',
      'cam06_high',
      'cam07_low_up',
      'cam08_low',
      'cam09_closeup_a',
      'cam10_closeup_b',
      'cam11_closeup_c',
      'cam12_closeup_d',
    ];
    expect(CAMERA_ANGLES.map((a) => a.id)).toEqual(expectedIds);
  });
});

describe('buildBlenderSystemPrompt', () => {
  const opts: BlenderPromptOptions = {
    depthDir: '/tmp/depth',
    normalDir: '/tmp/normal',
    resolution: 512,
  };

  it('returns a non-empty string', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes depthDir in output', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(prompt).toContain('/tmp/depth');
  });

  it('includes normalDir in output', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(prompt).toContain('/tmp/normal');
  });

  it('mentions 12 cameras', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(prompt).toMatch(/12/);
  });

  it('includes resolution value', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(prompt).toContain('512');
  });

  it('mentions EEVEE engine', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(prompt.toUpperCase()).toContain('EEVEE');
  });

  it('mentions depth map and normal map', () => {
    const prompt = buildBlenderSystemPrompt(opts);
    expect(prompt.toLowerCase()).toContain('depth');
    expect(prompt.toLowerCase()).toContain('normal');
  });

  it('uses different dirs when opts change', () => {
    const p1 = buildBlenderSystemPrompt({ depthDir: '/a', normalDir: '/b', resolution: 256 });
    const p2 = buildBlenderSystemPrompt({ depthDir: '/c', normalDir: '/d', resolution: 1024 });
    expect(p1).toContain('/a');
    expect(p1).toContain('/b');
    expect(p1).toContain('256');
    expect(p2).toContain('/c');
    expect(p2).toContain('/d');
    expect(p2).toContain('1024');
  });
});
