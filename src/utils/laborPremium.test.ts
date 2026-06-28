import { describe, it, expect } from 'vitest';
import { aggregatePremiumMinutes, getNightMinutes, getOvertimeMinutes, type LaborPremiumType } from './laborPremium';

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
  it('uses variable working hours threshold when enabled', () => {
    const daySlots = [{ start: new Date('2026-01-03T09:00:00'), end: new Date('2026-01-03T17:00:00') }];
    const weekSlots = [
      { start: new Date('2026-01-01T09:00:00'), end: new Date('2026-01-01T19:00:00') },
      { start: new Date('2026-01-02T09:00:00'), end: new Date('2026-01-02T19:00:00') },
      ...daySlots,
    ];
    expect(getOvertimeMinutes(daySlots, 8, 40, weekSlots, {
      variableWorkingHoursEnabled: true,
      variablePeriod: 'week',
      variableThresholdHours: 24,
    })).toBe(240);
  });
});

describe('aggregatePremiumMinutes', () => {
  const types: LaborPremiumType[] = [
    {
      id: 'night',
      name: '深夜',
      is_enabled: true,
      rate: 25,
      calc_method: 'additive',
      builtin_type: 'night',
      night_start_hour: 22,
      night_end_hour: 5,
      overtime_daily_threshold_hours: null,
      overtime_weekly_threshold_hours: null,
    },
    {
      id: 'overtime',
      name: '時間外',
      is_enabled: true,
      rate: 25,
      calc_method: 'additive',
      builtin_type: 'overtime',
      night_start_hour: null,
      night_end_hour: null,
      overtime_daily_threshold_hours: 8,
      overtime_weekly_threshold_hours: null,
    },
  ];

  it('can compare planned and actual premium minutes', () => {
    const planned = aggregatePremiumMinutes(types, [
      { start_at: '2026-01-01T09:00:00', end_at: '2026-01-01T17:00:00' },
      { start_at: '2026-01-01T22:00:00', end_at: '2026-01-02T00:00:00' },
    ]);
    const actual = aggregatePremiumMinutes(types, [
      { start_at: '2026-01-01T09:00:00', end_at: '2026-01-01T19:00:00' },
      { start_at: '2026-01-01T22:00:00', end_at: '2026-01-02T01:00:00' },
    ]);

    expect(planned.night).toBe(120);
    expect(actual.night).toBe(180);
    expect(actual.night - planned.night).toBe(60);
    expect(actual.overtime).toBeGreaterThan(planned.overtime);
  });
});
