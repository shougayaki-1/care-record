import type { StatisticsData } from '@/app/actions/statistics';
import type { Json } from '@/types/database.generated';
import type {
  InternalWorkRecordForAggregation,
  ReportForUnplannedVariance,
  ReportValuesData,
  ShiftDataForAggregation,
  ShiftWithLinksForVariance,
} from './statisticsAggregation';
import type { LaborPremiumType } from './laborPremium';

export type StatisticsSourceData = {
  rawShifts: ShiftDataForAggregation[];
  rawReports: ReportForUnplannedVariance[];
  premiumTypes: LaborPremiumType[];
  rawShiftsWithLinks: ShiftWithLinksForVariance[];
  internalWorkRecords: InternalWorkRecordForAggregation[];
};

export const initialStatisticsSourceData: StatisticsSourceData = {
  rawShifts: [], rawReports: [], premiumTypes: [], rawShiftsWithLinks: [], internalWorkRecords: [],
};

// Read only fields consumed by aggregation; preserve legacy helper coercion.
export function toReportValues(data: Json): ReportValuesData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return {
    _helpers: Array.isArray(data._helpers) ? data._helpers.map(String).filter(Boolean) : undefined,
    service_time: typeof data.service_time === 'string' || typeof data.service_time === 'number' ? data.service_time : undefined,
    travel_time: typeof data.travel_time === 'string' || typeof data.travel_time === 'number' ? data.travel_time : undefined,
  };
}

export function normalizeStatisticsValues(values: { data: Json } | Array<{ data: Json }> | null) {
  // The current one-to-one relation returns an object; accept legacy arrays too.
  const rows = values == null ? [] : Array.isArray(values) ? values : [values];
  return rows.map(value => ({ data: toReportValues(value.data) }));
}

type ReportSource = Pick<StatisticsData['reports'][number], 'start_at' | 'end_at' | 'status' | 'report_values'>;
function toReport<T extends ReportSource>(report: T) {
  // SQL range filters exclude undated reports; nested draft relations may be undated.
  return { ...report, start_at: report.start_at ?? '', end_at: report.end_at ?? '', status: report.status ?? '',
    report_values: normalizeStatisticsValues(report.report_values) };
}

function toPremiumType(type: StatisticsData['premiumTypes'][number]): LaborPremiumType {
  const { calc_method, builtin_type, variable_overtime_period } = type;
  if ((calc_method !== 'additive' && calc_method !== 'multiplicative')
    || (builtin_type !== null && builtin_type !== 'night' && builtin_type !== 'overtime' && builtin_type !== 'custom')
    || (variable_overtime_period !== null && variable_overtime_period !== 'week' && variable_overtime_period !== 'month')) {
    throw new Error('割増設定の形式を確認してください。');
  }
  return { ...type, calc_method, builtin_type, variable_overtime_period };
}

export function toStatisticsSource(data: StatisticsData): StatisticsSourceData {
  return {
    rawShifts: data.shifts.map(shift => ({ ...shift, status: shift.status ?? '' })),
    rawReports: data.reports.map(toReport),
    internalWorkRecords: data.internalWorkRecords,
    premiumTypes: data.premiumTypes.map(toPremiumType),
    rawShiftsWithLinks: data.shiftsWithLinks.map(shift => ({ ...shift,
      report_shifts: shift.report_shifts.map(link => ({ ...link, reports: link.reports ? toReport(link.reports) : null })),
      shift_segments: shift.shift_segments.map(segment => ({ ...segment, reports: segment.reports.map(toReport) })),
    })),
  };
}
