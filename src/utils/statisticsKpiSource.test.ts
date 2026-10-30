import { describe, expect, it } from 'vitest';
import { aggregateByTab, summarizeStatisticsRows } from './statisticsAggregation';
import { summarizeKpiSource } from './statisticsKpiSource';

describe('aggregate-only statistics projection', () => {
  it('matches both screen totals for shared visits and internal work without returning individuals', () => {
    const start_at = '2026-07-01T00:00:00+09:00';
    const end_at = '2026-07-01T02:00:00+09:00';
    const screen = aggregateByTab({ targetMonth: '2026-07', premiumTypes: [],
      rawShifts: [{ id: 's', start_at, end_at, status: 'published', client_id: 'c', clients: { name: 'Client' },
        shift_staffs: [{ staff_id: 'a', staffs: { name: 'A' } }, { staff_id: 'b', staffs: { name: 'B' } }] }],
      rawReports: [{ id: 'r', start_at, end_at, status: 'pending', client_id: 'c', clients: { name: 'Client' },
        report_values: [{ data: { service_time: 1, travel_time: 0.5 } }],
        report_actual_staffs: [{ staff: { name: 'A' } }, { staff: { name: 'B' } }] }],
      internalWorkRecords: [{ id: 'i', title: 'Meeting', start_at, end_at, status: 'remanded', work_hours: 0.5, staffs: { name: 'A' } }],
    });
    const result = summarizeKpiSource('2026-07', {
      shifts: [{ start_at, end_at, staff_count: 2, client_visible: true }],
      reports: [{ start_at, end_at, status: 'pending', staff_count: 2, client_visible: true, service_time: 1, travel_time: 0.5 }],
      internal_work: [{ start_at, end_at, status: 'remanded', work_hours: 0.5 }],
    });
    expect(result.byStaff).toEqual(summarizeStatisticsRows(screen.byStaff.rows));
    expect(result.byClient).toEqual(summarizeStatisticsRows(screen.byClient.rows));
    expect(JSON.stringify(result)).not.toMatch(/"Client"|"Meeting"|start_at|staff_count/);
  });
  it('rejects invalid or excessive staff counts instead of allocating or truncating', () => {
    const source = { shifts: [{ start_at: '', end_at: '', staff_count: 201, client_visible: true }], reports: [], internal_work: [] };
    expect(() => summarizeKpiSource('2026-07', source)).toThrow();
  });
});
