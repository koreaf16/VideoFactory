import { describe, it, expect } from 'vitest';
import { buildLoraInferenceWorkflow } from '../../src/comfyui/workflows/lora-workflows';
import { buildCaptionWorkflow } from '../../src/comfyui/workflows/caption-workflows';

describe('buildLoraInferenceWorkflow', () => {
  it('includes LoraLoader node with correct file', () => {
    const wf = buildLoraInferenceWorkflow({
      loraFileName: 'my_char_v1.safetensors',
      prompt: 'sks_char, beach scene',
      seed: 123,
      loraStrength: 0.7,
    });
    const loraNode = Object.values(wf).find(
      (n) => (n as { class_type: string }).class_type === 'LoraLoader',
    ) as { inputs: { lora_name: string; strength_model: number } };
    expect(loraNode).toBeDefined();
    expect(loraNode.inputs.lora_name).toBe('my_char_v1.safetensors');
    expect(loraNode.inputs.strength_model).toBe(0.7);
  });
});

describe('buildCaptionWorkflow', () => {
  it('includes Florence2Run node', () => {
    const wf = buildCaptionWorkflow({ imageName: 'test.png' });
    const nodes = Object.values(wf);
    const classTypes = nodes.map((n) => (n as { class_type: string }).class_type);
    expect(classTypes).toContain('Florence2Run');
  });
});
