import { describe, expect, it } from 'vitest';
import type { StatisticsData } from '@/app/actions/statistics';
import { aggregateByTab, buildShiftVarianceRows } from './statisticsAggregation';
import { normalizeStatisticsValues, toReportValues, toStatisticsSource } from './statisticsSource';

const report = {
  id: 'report', start_at: '2026-10-22T01:00:00Z', end_at: '2026-10-22T03:00:00Z', status: 'approved',
  client_id: 'client', segment_id: null, actual_service_type_id: null,
  clients: { id: 'client', name: '利用者A', organization_id: 'org' }, helper: { name: '旧担当者' },
  report_values: { data: { _helpers: ['職員A'], service_time: 1, travel_time: '0.5' } },
  actual_service_type: null, report_actual_staffs: [], report_shifts: [],
} satisfies StatisticsData['reports'][number];
const source: StatisticsData = { shifts: [], reports: [report], shiftsWithLinks: [], premiumTypes: [], internalWorkRecords: [] };

describe('statistics source boundary', () => {
  it('normalizes current object and legacy array relations identically', () => {
    expect(normalizeStatisticsValues(report.report_values)).toEqual(normalizeStatisticsValues([report.report_values]));
    expect(normalizeStatisticsValues(null)).toEqual([]);
  });
  it('keeps the service, travel and helper values from the database relation', () => {
    const input = toStatisticsSource(source);
    const { byStaff } = aggregateByTab({ ...input, targetMonth: '2026-10', premiumTypes: [] });
    expect(byStaff.rows).toEqual([expect.objectContaining({ name: '職員A', actualHours: 1.5, serviceHours: 1, travelHours: 0.5 })]);
    expect(buildShiftVarianceRows({ rawShiftsWithLinks: input.rawShiftsWithLinks, rawReports: input.rawReports, targetMonth: '2026-10' })[0]).toEqual(expect.objectContaining({ actualH: 1.5, staffNames: '職員A', reportId: 'report' }));
  });
  it('normalizes nested shift and segment reports without losing links', () => {
    const linkedReport = { ...report, deleted_at: null };
    const shift = { id: 'shift', client_id: 'client', start_at: report.start_at, end_at: report.end_at, status: 'scheduled',
      clients: { name: '利用者A' }, shift_staffs: [], report_shifts: [{ is_primary: true, reports: linkedReport }],
      shift_segments: [{ id: 'segment', start_at: report.start_at, end_at: report.end_at, sort_order: 0,
        service_type: null, shift_segment_staffs: [], reports: [linkedReport] }] };
    const input = toStatisticsSource({ ...source, shifts: [shift], shiftsWithLinks: [shift] });
    expect(input.rawShiftsWithLinks[0].report_shifts[0].reports?.report_values?.[0].data.service_time).toBe(1);
    expect(input.rawShiftsWithLinks[0].shift_segments?.[0].reports?.[0].id).toBe('report');
  });
  it('ignores unrelated JSON and retains legacy helper string coercion', () => {
    expect(toReportValues(null)).toEqual({});
    expect(toReportValues([])).toEqual({});
    expect(toReportValues({ _helpers: [2, '職員A'], service_time: true, travel_time: {} })).toEqual({ _helpers: ['2', '職員A'], service_time: undefined, travel_time: undefined });
  });
});
