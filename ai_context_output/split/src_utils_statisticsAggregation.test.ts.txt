import { describe, expect, it } from 'vitest';

import type { LaborPremiumType } from './laborPremium';
import {
  aggregateByTab,
  buildShiftVarianceRows,
  buildStatisticsCsv,
  clipSlotToMonth,
  getOverlappingHours,
  getReportHelperNames,
  getReportHours,
  isSlotClipped,
  namesDiffer,
  type AggregatedRow,
} from './statisticsAggregation';

describe('aggregateByTab', () => {
  it('returns empty staff and client results for empty input', () => {
    expect(aggregateByTab({
      rawShifts: [],
      rawReports: [],
      internalWorkRecords: [],
      targetMonth: '2026-07',
      premiumTypes: [],
    })).toEqual({
      byStaff: { rows: [], premiumComparisonPerStaff: {}, detailItemsPerStaff: {} },
      byClient: { rows: [], premiumComparisonPerStaff: {}, detailItemsPerStaff: {} },
    });
  });

  it('aggregates a month-crossing shift, report breakdown, and internal work without changing attribution', () => {
    const result = aggregateByTab({
      rawShifts: [{
        id: 'shift-1',
        start_at: '2026-06-30T23:00:00+09:00',
        end_at: '2026-07-01T02:00:00+09:00',
        status: 'scheduled',
        client_id: 'client-1',
        clients: { name: '利用者A' },
        shift_staffs: [{ staff_id: 'staff-1', staffs: { name: '佐藤' } }],
      }],
      rawReports: [{
        id: 'report-1',
        start_at: '2026-07-01T00:00:00+09:00',
        end_at: '2026-07-01T02:00:00+09:00',
        status: 'pending',
        client_id: 'client-1',
        clients: { name: '利用者A' },
        report_values: [{ data: { _helpers: ['佐藤'], service_time: 1, travel_time: 0.5 } }],
        report_shifts: [{ shift_id: 'shift-1' }],
      }],
      internalWorkRecords: [{
        id: 'internal-1',
        title: '会議',
        start_at: '2026-07-02T10:00:00+09:00',
        end_at: '2026-07-02T10:30:00+09:00',
        work_hours: 0.5,
        status: 'approved',
        staffs: { name: '佐藤' },
      }],
      targetMonth: '2026-07',
      premiumTypes: [],
    });

    expect(result.byStaff.rows).toEqual([{
      name: '佐藤',
      plannedHours: 2,
      actualHours: 2,
      serviceHours: 1,
      travelHours: 0.5,
      internalHours: 0.5,
      statusCounts: { pending: 1, remanded: 0 },
    }]);
    expect(result.byClient.rows).toEqual([{
      name: '利用者A',
      plannedHours: 2,
      actualHours: 1.5,
      serviceHours: 1,
      travelHours: 0.5,
      internalHours: 0,
      statusCounts: { pending: 1, remanded: 0 },
    }]);
    expect(result.byStaff.detailItemsPerStaff.佐藤).toHaveLength(3);
  });
});

describe('buildShiftVarianceRows', () => {
  it('builds segment variance, detects mismatches, and emits only truly unplanned reports', () => {
    const linkedReport = {
      id: 'report-linked',
      start_at: '2026-07-01T10:00:00+09:00',
      end_at: '2026-07-01T11:30:00+09:00',
      status: 'approved',
      segment_id: 'segment-1',
      report_values: [{ data: { service_time: 1.5 } }],
      actual_service_type: { name: '身体介護' },
      report_actual_staffs: [{ staff: { name: '鈴木' } }],
    };
    const rows = buildShiftVarianceRows({
      rawShiftsWithLinks: [{
        id: 'shift-1',
        start_at: '2026-07-01T10:00:00+09:00',
        end_at: '2026-07-01T11:00:00+09:00',
        client_id: 'client-1',
        clients: { name: '利用者A' },
        shift_staffs: [{ staffs: { name: '佐藤' } }],
        report_shifts: [],
        shift_segments: [{
          id: 'segment-1',
          start_at: '2026-07-01T10:00:00+09:00',
          end_at: '2026-07-01T11:00:00+09:00',
          sort_order: 0,
          service_type: { name: '生活援助' },
          shift_segment_staffs: [{ staff_id: 'staff-1', staff: { name: '佐藤' } }],
          reports: [linkedReport],
        }],
      }],
      rawReports: [{
        ...linkedReport,
        client_id: 'client-1',
        clients: { name: '利用者A' },
        helper: null,
        report_shifts: [{ shift_id: 'shift-1' }],
      }, {
        id: 'report-unplanned',
        start_at: '2026-07-02T09:00:00+09:00',
        end_at: '2026-07-02T10:00:00+09:00',
        status: 'pending',
        segment_id: null,
        client_id: 'client-2',
        clients: { name: '利用者B' },
        helper: { name: '田中' },
        report_values: null,
        report_shifts: [],
      }],
      targetMonth: '2026-07',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'segment-segment-1',
      plannedH: 1,
      actualH: 1.5,
      diffH: 0.5,
      staffNames: '佐藤',
      actualStaffNames: '鈴木',
      hasStaffMismatch: true,
      actualServiceTypeName: '身体介護',
      hasServiceTypeMismatch: true,
      isUnplanned: false,
    });
    expect(rows[1]).toMatchObject({
      id: 'unplanned-report-report-unplanned',
      plannedH: null,
      actualH: 1,
      diffH: 1,
      staffNames: '田中',
      isUnplanned: true,
    });
  });
});

describe('statistics month boundaries', () => {
  const monthStart = new Date('2026-07-01T00:00:00.000Z');
  const monthEnd = new Date('2026-08-01T00:00:00.000Z');

  it('counts only the portion overlapping the target month', () => {
    const start = new Date('2026-06-30T23:00:00.000Z');
    const end = new Date('2026-07-01T02:00:00.000Z');

    expect(getOverlappingHours(start, end, monthStart, monthEnd)).toBe(2);
    const clipped = clipSlotToMonth(start.toISOString(), end.toISOString(), monthStart, monthEnd);
    expect(clipped).toEqual({
      start_at: '2026-07-01T00:00:00.000Z',
      end_at: '2026-07-01T02:00:00.000Z',
    });
    expect(isSlotClipped(start.toISOString(), end.toISOString(), clipped)).toBe(true);
  });

  it('returns no overlap for a slot outside the target month', () => {
    expect(clipSlotToMonth(
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T01:00:00.000Z',
      monthStart,
      monthEnd,
    )).toBeNull();
  });
});

describe('report aggregation helpers', () => {
  it('prefers explicit service and travel hours over timestamps', () => {
    expect(getReportHours(
      { service_time: '1.5', travel_time: 0.5 },
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T08:00:00.000Z',
    )).toEqual({ serviceHours: 1.5, travelHours: 0.5, totalHours: 2 });
  });

  it('falls back to the timestamp duration when explicit hours are absent', () => {
    expect(getReportHours(
      null,
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T02:30:00.000Z',
    )).toEqual({ serviceHours: 2.5, travelHours: 0, totalHours: 2.5 });
  });

  it('uses actual staff rows before legacy helper names and fallback', () => {
    expect(getReportHelperNames(
      { _helpers: ['旧担当'] },
      '予備担当',
      [{ staff: { name: '実績担当' } }],
    )).toEqual(['実績担当']);
    expect(getReportHelperNames({ _helpers: ['旧担当'] }, '予備担当')).toEqual(['旧担当']);
    expect(getReportHelperNames(null, '予備担当')).toEqual(['予備担当']);
  });

  it('compares normalized staff sets while treating missing actual staff as no mismatch', () => {
    expect(namesDiffer(['佐藤', '鈴木', '佐藤'], ['鈴木', '佐藤'])).toBe(false);
    expect(namesDiffer(['佐藤'], ['鈴木'])).toBe(true);
    expect(namesDiffer(['佐藤'], [])).toBe(false);
  });
});

describe('buildStatisticsCsv', () => {
  const row: AggregatedRow = {
    name: '佐藤',
    plannedHours: 2,
    actualHours: 2.5,
    serviceHours: 2,
    travelHours: 0.5,
    internalHours: 0,
    statusCounts: { pending: 1, remanded: 0 },
  };
  const premiumType: LaborPremiumType = {
    id: 'night',
    name: '深夜',
    is_enabled: true,
    rate: 0.25,
    calc_method: 'additive',
    builtin_type: 'night',
    night_start_hour: 22,
    night_end_hour: 5,
    overtime_daily_threshold_hours: null,
    overtime_weekly_threshold_hours: null,
  };

  it('preserves the staff CSV columns, BOM, status labels, and premium conversion', () => {
    const csv = buildStatisticsCsv(
      [row],
      { 佐藤: { night: { planned: 60, actual: 90, diff: 30 } } },
      [premiumType],
      0,
    );

    expect(csv).toBe(
      '\uFEFF氏名,予定時間(h),実績時間(h),サービス(h),移動(h),内勤(h),差異(h),承認待ち件数,差戻し件数,深夜予定(h),深夜実績(h),深夜差異(h)\n'
      + '"佐藤",2.00,2.50,2.00,0.50,0.00,0.50,1,0,1.00,1.50,0.50',
    );
  });

  it('omits premium columns for client aggregation', () => {
    const [header] = buildStatisticsCsv([row], {}, [premiumType], 1).slice(1).split('\n');
    expect(header).not.toContain('深夜');
  });
});
