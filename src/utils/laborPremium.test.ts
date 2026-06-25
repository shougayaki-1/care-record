import { describe, it, expect } from 'vitest';
import { getNightMinutes, getOvertimeMinutes } from './laborPremium';

describe('getNightMinutes', () => {
  it('counts minutes in 22:00-01:00 (crosses midnight)', () => {
    expect(getNightMinutes(new Date('2026-01-01T22:00:00'), new Date('2026-01-02T01:00:00'), 22, 5)).toBe(180);
  });
  it('counts no minutes for daytime shift', () => {
    expect(getNightMinutes(new Date('2026-01-01T09:00:00'), new Date('2026-01-01T17:00:00'), 22, 5)).toBe(0);
  });
});

describe('getOvertimeMinutes', () => {
  it('returns 0 when within daily threshold', () => {
    const slots = [{ start: new Date('2026-01-01T09:00:00'), end: new Date('2026-01-01T16:00:00') }];
    expect(getOvertimeMinutes(slots, 8, null)).toBe(0);
  });
  it('returns excess above daily threshold', () => {
    const slots = [{ start: new Date('2026-01-01T08:00:00'), end: new Date('2026-01-01T18:00:00') }];
    expect(getOvertimeMinutes(slots, 8, null)).toBe(120);
  });
});
