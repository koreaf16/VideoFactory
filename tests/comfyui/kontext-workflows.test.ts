import { describe, it, expect } from 'vitest';
import {
  buildKontextAnchorWorkflow,
  buildKontextEditWorkflow,
} from '../../src/comfyui/workflows/kontext-workflows';

describe('buildKontextAnchorWorkflow', () => {
  it('returns workflow with correct node types', () => {
    const wf = buildKontextAnchorWorkflow({
      prompt: 'test character, front view',
      seed: 12345,
    });
    const nodes = Object.values(wf);
    const classTypes = nodes.map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('KSampler');
    expect(classTypes).toContain('SaveImage');
  });

  it('applies custom seed', () => {
    const wf = buildKontextAnchorWorkflow({ prompt: 'test', seed: 99999 });
    const sampler = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'KSampler',
    ) as { inputs: { seed: number } };
    expect(sampler.inputs.seed).toBe(99999);
  });

  it('uses default resolution 1024x1024', () => {
    const wf = buildKontextAnchorWorkflow({ prompt: 'test', seed: 1 });
    const latent = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'EmptyLatentImage',
    ) as { inputs: { width: number; height: number } };
    expect(latent.inputs.width).toBe(1024);
    expect(latent.inputs.height).toBe(1024);
  });
});

describe('buildKontextEditWorkflow', () => {
  it('returns workflow with LoadImage node referencing anchor', () => {
    const wf = buildKontextEditWorkflow({
      anchorImageName: 'anchor_001.png',
      editPrompt: 'same character, sitting in cafe',
      seed: 12345,
    });
    const loadImage = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'LoadImage',
    ) as { inputs: { image: string } };
    expect(loadImage).toBeDefined();
    expect(loadImage.inputs.image).toBe('anchor_001.png');
  });
});
