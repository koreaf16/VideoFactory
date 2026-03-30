import { describe, it, expect } from 'vitest';
import {
  buildControlNetCandidateWorkflow,
  buildControlNetDerivativeWorkflow,
  CONTROLNET_DEFAULTS,
} from '../../src/comfyui/workflows/controlnet-workflows';

describe('buildControlNetCandidateWorkflow', () => {
  it('returns workflow with ControlNetLoader and ControlNetApplyAdvanced nodes', () => {
    const wf = buildControlNetCandidateWorkflow({
      depthMapName: 'depth_001.png',
      normalMapName: 'normal_001.png',
      prompt: 'a cozy coffee shop, warm lighting',
      seed: 12345,
    });
    const nodes = Object.values(wf);
    const classTypes = nodes.map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('ControlNetLoader');
    expect(classTypes).toContain('ControlNetApplyAdvanced');
    expect(classTypes).toContain('KSampler');
    expect(classTypes).toContain('SaveImage');
  });

  it('loads depth map image (LoadImage node contains depthMapName)', () => {
    const wf = buildControlNetCandidateWorkflow({
      depthMapName: 'depth_scene42.png',
      normalMapName: 'normal_scene42.png',
      prompt: 'test location',
      seed: 1,
    });
    const loadImageNodes = Object.values(wf).filter(
      (n) => (n as { class_type: string }).class_type === 'LoadImage',
    ) as { inputs: { image: string } }[];
    const imageNames = loadImageNodes.map((n) => n.inputs.image);
    expect(imageNames).toContain('depth_scene42.png');
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
  it('includes IPAdapterAdvanced and CLIPVisionLoader nodes', () => {
    const wf = buildControlNetDerivativeWorkflow({
      depthMapName: 'depth_001.png',
      normalMapName: 'normal_001.png',
      prompt: 'a cozy coffee shop, warm lighting',
      seed: 12345,
      styleAnchorName: 'anchor_001.png',
    });
    const nodes = Object.values(wf);
    const classTypes = nodes.map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('IPAdapterAdvanced');
    expect(classTypes).toContain('CLIPVisionLoader');
  });

  it('loads style anchor image', () => {
    const wf = buildControlNetDerivativeWorkflow({
      depthMapName: 'depth.png',
      normalMapName: 'normal.png',
      prompt: 'test',
      seed: 1,
      styleAnchorName: 'anchor_scene42.png',
    });
    const loadImageNodes = Object.values(wf).filter(
      (n) => (n as { class_type: string }).class_type === 'LoadImage',
    ) as { inputs: { image: string } }[];
    const imageNames = loadImageNodes.map((n) => n.inputs.image);
    expect(imageNames).toContain('anchor_scene42.png');
  });

  it('KSampler model comes from node 17 (IPAdapter), not node 1 (UNETLoader)', () => {
    const wf = buildControlNetDerivativeWorkflow({
      depthMapName: 'depth.png',
      normalMapName: 'normal.png',
      prompt: 'test',
      seed: 1,
      styleAnchorName: 'anchor.png',
    });
    const sampler = wf['11'] as { inputs: { model: unknown } };
    expect(sampler).toBeDefined();
    expect(sampler.inputs.model).toEqual(['17', 0]);
  });
});

describe('CONTROLNET_DEFAULTS', () => {
  it('strength values are within expected ranges', () => {
    expect(CONTROLNET_DEFAULTS.depthStrength).toBeGreaterThan(0);
    expect(CONTROLNET_DEFAULTS.depthStrength).toBeLessThanOrEqual(1);
    expect(CONTROLNET_DEFAULTS.normalStrength).toBeGreaterThan(0);
    expect(CONTROLNET_DEFAULTS.normalStrength).toBeLessThanOrEqual(1);
    expect(CONTROLNET_DEFAULTS.ipAdapterStrength).toBeGreaterThan(0);
    expect(CONTROLNET_DEFAULTS.ipAdapterStrength).toBeLessThanOrEqual(1);
  });
});
