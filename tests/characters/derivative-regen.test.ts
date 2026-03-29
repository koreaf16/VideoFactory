import { describe, it, expect } from 'vitest';
import { buildRegenPrompt } from '../../src/characters/services/derivative-generator';

describe('buildRegenPrompt', () => {
  it('원본 프롬프트와 수정 지시를 조합한다', () => {
    const result = buildRegenPrompt(
      'Change her expression to a gentle warm smile.',
      '눈을 더 크게 만들어줘',
    );
    expect(result).toBe(
      'Change her expression to a gentle warm smile. Additionally: 눈을 더 크게 만들어줘',
    );
  });

  it('수정 지시가 빈 문자열이면 원본 프롬프트만 반환한다', () => {
    const result = buildRegenPrompt('Change her expression to a gentle warm smile.', '');
    expect(result).toBe('Change her expression to a gentle warm smile.');
  });

  it('수정 지시의 앞뒤 공백을 제거한다', () => {
    const result = buildRegenPrompt('Base prompt.', '  trim this  ');
    expect(result).toBe('Base prompt. Additionally: trim this');
  });
});
