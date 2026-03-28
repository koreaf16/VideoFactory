import { describe, it, expect } from 'vitest';
import { DEFAULT_TRAINING_CONFIG, TEST_PROMPTS } from '../../src/characters/types/lora.types';
import type { LoraDataset, LoraTrainingJob } from '../../src/characters/types/lora.types';

describe('LoRA types', () => {
  it('DEFAULT_TRAINING_CONFIG has expected defaults', () => {
    expect(DEFAULT_TRAINING_CONFIG.networkDim).toBe(16);
    expect(DEFAULT_TRAINING_CONFIG.learningRate).toBe(5e-5);
    expect(DEFAULT_TRAINING_CONFIG.maxTrainSteps).toBe(1500);
    expect(DEFAULT_TRAINING_CONFIG.optimizer).toBe('AdamW8bit');
  });

  it('TEST_PROMPTS has 5 entries', () => {
    expect(TEST_PROMPTS).toHaveLength(5);
  });

  it('types are structurally valid', () => {
    const dataset: LoraDataset = {
      datasetId: 'ds-001',
      charId: 'ch-001',
      name: 'test',
      triggerWord: 'sks_test',
      status: 'preparing',
      imageCount: 0,
      createdAt: new Date(),
    };
    expect(dataset.status).toBe('preparing');
  });
});
