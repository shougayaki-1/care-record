import { describe, expect, it } from 'vitest';
import { matchCandidateName, matchesSelectedClient } from './matchCandidate';

describe('matchCandidateName', () => {
  it('matches names despite full-width or ordinary spaces', () => {
    const candidates = [{ id: 'one', name: '山田太郎' }];
    expect(matchCandidateName('山田　太郎', candidates)?.id).toBe('one');
    expect(matchCandidateName('山田 太郎', candidates)?.id).toBe('one');
  });

  it('does not guess from partial or duplicate names', () => {
    expect(matchCandidateName('山田', [{ id: 'one', name: '山田太郎' }])).toBeNull();
    expect(matchCandidateName('山田 太郎', [
      { id: 'one', name: '山田太郎' }, { id: 'two', name: '山田 太郎' },
    ])).toBeNull();
  });

  it('blocks applying a different or unreadable client to a selected client form', () => {
    const clients = [{ id: 'one', name: '山田太郎' }];
    expect(matchesSelectedClient('山田 太郎', null, clients)).toBe(true);
    expect(matchesSelectedClient('山田 太郎', 'one', clients)).toBe(true);
    expect(matchesSelectedClient('山田 太郎', 'other', clients)).toBe(false);
    expect(matchesSelectedClient('別の利用者', 'one', clients)).toBe(false);
    expect(matchesSelectedClient('', null, clients)).toBe(false);
  });
});
