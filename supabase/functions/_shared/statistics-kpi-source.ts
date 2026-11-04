// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import { summarizeMonthlyStatistics } from './statistics-aggregation.ts';

// This is an internal projection, not an MCP response. The database must enforce
// authorization and limit the number of rows before returning it.
export type StatisticsKpiSource = {
  shifts: Array<{ start_at: string; end_at: string; staff_count: number; client_visible: boolean }>;
  reports: Array<{ start_at: string; end_at: string; status: string; staff_count: number;
    client_visible: boolean; service_time: string | number | null; travel_time: string | number | null }>;
  internal_work: Array<{ start_at: string; end_at: string; status: string; work_hours: number }>;
};

/** Reuse the screen aggregation without sending names or individual rows to MCP. */
export function summarizeKpiSource(month: string, source: StatisticsKpiSource) {
  if (source.shifts.length + source.reports.length + source.internal_work.length > 5000
    || [...source.shifts, ...source.reports].some(row => !Number.isSafeInteger(row.staff_count) || row.staff_count < 0 || row.staff_count > 200)) {
    throw new Error('集計対象が多すぎるか、担当人数が不正です');
  }
  const client = { name: 'client' };
  return summarizeMonthlyStatistics({
    targetMonth: month,
    premiumTypes: [],
    rawShifts: source.shifts.map((shift, index) => ({
      id: `s${index}`, start_at: shift.start_at, end_at: shift.end_at, status: 'published',
      client_id: 'client', clients: shift.client_visible ? client : null,
      shift_staffs: Array.from({ length: shift.staff_count }, (_, i) => ({ staff_id: `s${i}`, staffs: { name: `staff${i}` } })),
    })),
    rawReports: source.reports.map((report, index) => ({
      id: `r${index}`, start_at: report.start_at, end_at: report.end_at, status: report.status,
      client_id: 'client', clients: report.client_visible ? client : null,
      report_values: [{ data: { service_time: report.service_time ?? undefined, travel_time: report.travel_time ?? undefined } }],
      report_actual_staffs: Array.from({ length: report.staff_count }, (_, i) => ({ staff: { name: `staff${i}` } })),
    })),
    internalWorkRecords: source.internal_work.map((record, index) => ({
      ...record, id: `i${index}`, title: '', staffs: { name: 'staff' },
    })),
  });
}
