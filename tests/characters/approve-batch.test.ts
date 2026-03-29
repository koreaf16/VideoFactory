import { describe, it, expect } from 'vitest';
import { parseApproveBatchBody } from '../../src/characters/routes/gallery-routes';

describe('parseApproveBatchBody', () => {
  it('refIds가 없으면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ approved: true })).toBeNull();
  });

  it('refIds가 빈 배열이면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [], approved: true })).toBeNull();
  });

  it('approved가 boolean이 아니면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [1, 2], approved: 1 })).toBeNull();
  });

  it('approved가 없으면 null을 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [1] })).toBeNull();
  });

  it('유효한 입력이면 파싱된 객체를 반환한다', () => {
    expect(parseApproveBatchBody({ refIds: [1, 2, 3], approved: false })).toEqual({
      refIds: [1, 2, 3],
      approved: false,
    });
  });
});
