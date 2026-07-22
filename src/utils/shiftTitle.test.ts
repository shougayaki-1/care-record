import { describe, expect, it } from 'vitest';

import { buildShiftTitle } from './shiftTitle';

describe('buildShiftTitle', () => {
  it('includes each assigned staff member once', () => {
    expect(buildShiftTitle('利用者A', ['田中', '佐藤', '田中', ''])).toBe('利用者A (田中, 佐藤)');
  });

  it('keeps a client-only title when no staff member is assigned', () => {
    expect(buildShiftTitle('利用者A', [])).toBe('利用者A');
  });
});
