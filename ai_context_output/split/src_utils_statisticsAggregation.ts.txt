import { aggregatePremiumMinutes, type LaborPremiumType } from './laborPremium';
import { getReportStatusLabel } from './reportStatus';

export type ReportValuesData = {
  _helpers?: string[];
  service_time?: string | number;
  travel_time?: string | number;
};

export type AggregatedRow = {
  name: string;
  plannedHours: number;
  actualHours: number;
  serviceHours: number;
  travelHours: number;
  internalHours: number;
  statusCounts: { pending: number; remanded: number };
};

export type PremiumComparison = Record<string, { planned: number; actual: number; diff: number }>;

export type StaffDetailItem = {
  id: string;
  kind: 'planned' | 'actual' | 'internal';
  clientName: string;
  clientId?: string;
  shiftId?: string | null;
  reportId?: string | null;
  startAt: string;
  endAt: string;
  hours: number;
  status?: string;
  isMonthClipped?: boolean;
};

type NamedRelation = { name: string } | { name: string }[] | null;

export type ShiftDataForAggregation = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  client_id: string;
  clients: NamedRelation;
  shift_staffs: Array<{ staff_id: string; staffs: NamedRelation }>;
};

export type ReportDataForAggregation = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  client_id: string;
  clients: NamedRelation;
  helper?: NamedRelation;
  report_values: Array<{ data: ReportValuesData }> | null;
  report_actual_staffs?: Array<{ staff?: { name: string } | null }>;
  report_shifts?: Array<{ shift_id: string }> | null;
};

export type InternalWorkRecordForAggregation = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  work_hours: number;
  status: string;
  staffs: { name: string } | null;
};

export type AggregatedData = {
  rows: AggregatedRow[];
  premiumComparisonPerStaff: Record<string, PremiumComparison>;
  detailItemsPerStaff: Record<string, StaffDetailItem[]>;
};

export type ReportForVariance = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  segment_id?: string | null;
  deleted_at?: string | null;
  report_values?: Array<{ data: ReportValuesData }> | null;
  actual_service_type?: { name: string } | null;
  report_actual_staffs?: Array<{ staff?: { name: string } | null }>;
};

export type ShiftWithLinksForVariance = {
  id: string;
  start_at: string;
  end_at: string;
  client_id: string;
  clients: { name: string } | null;
  shift_staffs: Array<{ staffs: { name: string } | null }>;
  report_shifts: Array<{ is_primary: boolean; reports: ReportForVariance | null }>;
  shift_segments?: Array<{
    id: string;
    start_at: string;
    end_at: string;
    sort_order: number;
    service_type?: { name: string } | null;
    shift_segment_staffs?: Array<{ staff_id: string; staff?: { name: string } | null }>;
    reports?: ReportForVariance[];
  }>;
};

export type ReportForUnplannedVariance = ReportDataForAggregation & {
  segment_id?: string | null;
  actual_service_type?: { name: string } | null;
};

export type ShiftVarianceRow = {
  id: string;
  shiftId: string | null;
  clientId: string;
  clientName: string;
  staffNames: string;
  startAt: string;
  endAt: string | null;
  plannedH: number | null;
  actualH: number | null;
  diffH: number | null;
  reportId: string | null;
  segmentId: string | null;
  actualStaffNames: string;
  hasStaffMismatch: boolean;
  actualServiceTypeName: string | null;
  hasServiceTypeMismatch: boolean;
  isUnplanned: boolean;
  isLegacyReport: boolean;
  isMonthClipped: boolean;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getJstMonthBounds(targetMonth: string): { monthStart: Date; monthEnd: Date } {
  const [yearStr, monthStr] = targetMonth.split('-');
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;

  return {
    monthStart: new Date(Date.UTC(year, monthIndex, 1) - JST_OFFSET_MS),
    monthEnd: new Date(Date.UTC(year, monthIndex + 1, 1) - JST_OFFSET_MS),
  };
}

export function getOverlappingHours(start: Date, end: Date, monthStart: Date, monthEnd: Date): number {
  const overlapStart = start > monthStart ? start : monthStart;
  const overlapEnd = end < monthEnd ? end : monthEnd;
  if (overlapStart >= overlapEnd) return 0;
  return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
}

export function clipSlotToMonth(
  startAt: string,
  endAt: string,
  monthStart: Date,
  monthEnd: Date,
): { start_at: string; end_at: string } | null {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const overlapStart = start > monthStart ? start : monthStart;
  const overlapEnd = end < monthEnd ? end : monthEnd;
  if (overlapStart >= overlapEnd) return null;
  return { start_at: overlapStart.toISOString(), end_at: overlapEnd.toISOString() };
}

export function isSlotClipped(
  startAt: string,
  endAt: string,
  clipped: { start_at: string; end_at: string } | null,
): boolean {
  if (!clipped) return false;
  return clipped.start_at !== new Date(startAt).toISOString()
    || clipped.end_at !== new Date(endAt).toISOString();
}

export function getReportHours(
  dataObj: ReportValuesData | null,
  startAt: string,
  endAt: string,
  monthStart?: Date,
  monthEnd?: Date,
) {
  const serviceHours = parseFloat(String(dataObj?.service_time || 0)) || 0;
  const travelHours = parseFloat(String(dataObj?.travel_time || 0)) || 0;
  const explicitTotal = serviceHours + travelHours;
  if (explicitTotal > 0) return { serviceHours, travelHours, totalHours: explicitTotal };
  const start = new Date(startAt);
  const end = new Date(endAt);
  const fallback = monthStart && monthEnd
    ? getOverlappingHours(start, end, monthStart, monthEnd)
    : (end.getTime() - start.getTime()) / 3600000;
  return { serviceHours: fallback, travelHours: 0, totalHours: fallback };
}

export function getReportHelperNames(
  dataObj: ReportValuesData | null,
  fallback?: string | null,
  actualStaffs?: Array<{ staff?: { name: string } | null }>,
): string[] {
  const actualStaffNames = (actualStaffs ?? [])
    .map((staff) => staff.staff?.name)
    .filter((name): name is string => Boolean(name));
  if (actualStaffNames.length > 0) return actualStaffNames;
  const helpers = Array.isArray(dataObj?._helpers)
    ? dataObj._helpers.map(String).filter(Boolean)
    : [];
  return helpers.length > 0 ? helpers : (fallback ? [fallback] : []);
}

export function namesDiffer(planned: string[], actual: string[]): boolean {
  if (actual.length === 0) return false;
  const normalize = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort().join('|');
  return normalize(planned) !== normalize(actual);
}

export function aggregateByTab({
  rawShifts,
  rawReports,
  internalWorkRecords,
  targetMonth,
  premiumTypes,
}: {
  rawShifts: ShiftDataForAggregation[];
  rawReports: ReportDataForAggregation[];
  internalWorkRecords: InternalWorkRecordForAggregation[];
  targetMonth: string;
  premiumTypes: LaborPremiumType[];
}): { byStaff: AggregatedData; byClient: AggregatedData } {
  const computeAggregatedData = (targetTabIndex: 0 | 1): AggregatedData => {
    if (!targetMonth) {
      return {
        rows: [],
        premiumComparisonPerStaff: {},
        detailItemsPerStaff: {},
      };
    }

    const { monthStart, monthEnd } = getJstMonthBounds(targetMonth);

    const statsMap: Record<string, AggregatedRow> = {};
    const staffShiftsMap: Record<string, Array<{ start_at: string; end_at: string }>> = {};
    const staffReportsMap: Record<string, Array<{ start_at: string; end_at: string }>> = {};
    const detailItemsPerStaff: Record<string, StaffDetailItem[]> = {};

    const addHours = (
      name: string,
      type: 'planned' | 'actual',
      hours: number,
      breakdown?: Partial<Pick<AggregatedRow, 'serviceHours' | 'travelHours' | 'internalHours'>>,
    ) => {
      if (!name) return;
      if (!statsMap[name]) {
        statsMap[name] = {
          name,
          plannedHours: 0,
          actualHours: 0,
          serviceHours: 0,
          travelHours: 0,
          internalHours: 0,
          statusCounts: { pending: 0, remanded: 0 },
        };
      }
      if (type === 'planned') statsMap[name].plannedHours += hours;
      else {
        statsMap[name].actualHours += hours;
        statsMap[name].serviceHours += breakdown?.serviceHours ?? 0;
        statsMap[name].travelHours += breakdown?.travelHours ?? 0;
        statsMap[name].internalHours += breakdown?.internalHours ?? 0;
      }
    };
    const addStatusCount = (name: string, status?: string) => {
      if (!name || !statsMap[name]) return;
      if (status === 'pending') statsMap[name].statusCounts.pending += 1;
      if (status === 'remanded') statsMap[name].statusCounts.remanded += 1;
    };
    const addStaffSlot = (
      map: Record<string, Array<{ start_at: string; end_at: string }>>,
      name: string,
      start_at: string,
      end_at: string,
    ) => {
      if (!name) return;
      (map[name] ??= []).push({ start_at, end_at });
    };
    const addDetailItem = (name: string, item: StaffDetailItem) => {
      if (!name) return;
      (detailItemsPerStaff[name] ??= []).push(item);
    };

    rawShifts.forEach((shift) => {
      const shiftStart = new Date(shift.start_at);
      const shiftEnd = new Date(shift.end_at);
      const hours = getOverlappingHours(shiftStart, shiftEnd, monthStart, monthEnd);
      const clipped = clipSlotToMonth(shift.start_at, shift.end_at, monthStart, monthEnd);
      const isClipped = isSlotClipped(shift.start_at, shift.end_at, clipped);

      if (hours <= 0) return;
      const clientName = Array.isArray(shift.clients) ? shift.clients[0]?.name : shift.clients?.name;
      if (targetTabIndex === 1 && clientName) addHours(clientName, 'planned', hours);
      if (targetTabIndex !== 0) return;

      if (shift.shift_staffs && shift.shift_staffs.length > 0) {
        shift.shift_staffs.forEach((staff) => {
          const staffName = Array.isArray(staff.staffs) ? staff.staffs[0]?.name : staff.staffs?.name;
          const targetName = staffName || '未設定(スタッフ名なし)';
          addHours(targetName, 'planned', hours);
          if (clipped) addStaffSlot(staffShiftsMap, targetName, clipped.start_at, clipped.end_at);
          addDetailItem(targetName, {
            id: `planned-${shift.id}-${targetName}`,
            kind: 'planned',
            clientName: clientName ?? '—',
            clientId: shift.client_id,
            shiftId: shift.id,
            startAt: clipped?.start_at ?? shift.start_at,
            endAt: clipped?.end_at ?? shift.end_at,
            hours,
            status: shift.status,
            isMonthClipped: isClipped,
          });
        });
      } else {
        const targetName = '未設定(シフト担当者なし)';
        addHours(targetName, 'planned', hours);
        if (clipped) addStaffSlot(staffShiftsMap, targetName, clipped.start_at, clipped.end_at);
        addDetailItem(targetName, {
          id: `planned-${shift.id}-unassigned`,
          kind: 'planned',
          clientName: clientName ?? '—',
          clientId: shift.client_id,
          shiftId: shift.id,
          startAt: clipped?.start_at ?? shift.start_at,
          endAt: clipped?.end_at ?? shift.end_at,
          hours,
          status: shift.status,
          isMonthClipped: isClipped,
        });
      }
    });

    rawReports.forEach((report) => {
      const dataObj = report.report_values?.[0]?.data ?? null;
      const { serviceHours, travelHours, totalHours: actualHours } = getReportHours(
        dataObj,
        report.start_at,
        report.end_at,
        monthStart,
        monthEnd,
      );
      if (actualHours <= 0) return;

      const clientName = Array.isArray(report.clients) ? report.clients[0]?.name : report.clients?.name;
      if (targetTabIndex === 1 && clientName) {
        addHours(clientName, 'actual', actualHours, { serviceHours, travelHours });
        addStatusCount(clientName, report.status);
      }
      if (targetTabIndex !== 0) return;

      const actualHelpers = getReportHelperNames(dataObj, undefined, report.report_actual_staffs);
      const clipped = clipSlotToMonth(report.start_at, report.end_at, monthStart, monthEnd);
      const linkedShiftId = report.report_shifts?.[0]?.shift_id ?? null;
      const addActualForStaff = (helperName: string) => {
        addHours(helperName, 'actual', actualHours, { serviceHours, travelHours });
        addStatusCount(helperName, report.status);
        if (clipped) addStaffSlot(staffReportsMap, helperName, clipped.start_at, clipped.end_at);
        addDetailItem(helperName, {
          id: `actual-${report.id}-${helperName}`,
          kind: 'actual',
          clientName: clientName ?? '—',
          clientId: report.client_id,
          shiftId: linkedShiftId,
          reportId: report.id,
          startAt: clipped?.start_at ?? report.start_at,
          endAt: clipped?.end_at ?? report.end_at,
          hours: actualHours,
          status: report.status,
          isMonthClipped: isSlotClipped(report.start_at, report.end_at, clipped),
        });
      };

      if (actualHelpers.length > 0) {
        actualHelpers.forEach((helperName) => {
          if (helperName) addActualForStaff(String(helperName));
        });
      } else {
        const fallbackName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper?.name;
        if (fallbackName) {
          addActualForStaff(fallbackName);
        } else {
          const targetName = '未設定(担当者不明)';
          addHours(targetName, 'actual', actualHours);
          addStatusCount(targetName, report.status);
          if (clipped) addStaffSlot(staffReportsMap, targetName, clipped.start_at, clipped.end_at);
          addDetailItem(targetName, {
            id: `actual-${report.id}-unknown`,
            kind: 'actual',
            clientName: clientName ?? '—',
            clientId: report.client_id,
            shiftId: linkedShiftId,
            reportId: report.id,
            startAt: clipped?.start_at ?? report.start_at,
            endAt: clipped?.end_at ?? report.end_at,
            hours: actualHours,
            status: report.status,
            isMonthClipped: isSlotClipped(report.start_at, report.end_at, clipped),
          });
        }
      }
    });

    if (targetTabIndex === 0) {
      internalWorkRecords.forEach((record) => {
        const staffName = record.staffs?.name || '未設定(スタッフ名なし)';
        const hours = Number(record.work_hours) || 0;
        if (hours <= 0) return;
        addHours(staffName, 'actual', hours, { internalHours: hours });
        addStatusCount(staffName, record.status);
        addDetailItem(staffName, {
          id: `internal-${record.id}`,
          kind: 'internal',
          clientName: record.title,
          startAt: record.start_at,
          endAt: record.end_at,
          hours,
          status: record.status,
        });
      });
    }

    const rows = Object.values(statsMap).sort((a, b) => a.name.localeCompare(b.name));
    const premiumComparisonPerStaff: Record<string, PremiumComparison> = {};
    if (targetTabIndex === 0) {
      for (const staffName of Object.keys(statsMap)) {
        const planned = aggregatePremiumMinutes(premiumTypes, staffShiftsMap[staffName] ?? []);
        const actual = aggregatePremiumMinutes(premiumTypes, staffReportsMap[staffName] ?? []);
        premiumComparisonPerStaff[staffName] = {};
        for (const type of premiumTypes) {
          const plannedMinutes = planned[type.id] ?? 0;
          const actualMinutes = actual[type.id] ?? 0;
          premiumComparisonPerStaff[staffName][type.id] = {
            planned: plannedMinutes,
            actual: actualMinutes,
            diff: actualMinutes - plannedMinutes,
          };
        }
      }
    }

    return { rows, premiumComparisonPerStaff, detailItemsPerStaff };
  };

  return {
    byStaff: computeAggregatedData(0),
    byClient: computeAggregatedData(1),
  };
}

export function buildShiftVarianceRows({
  rawShiftsWithLinks,
  rawReports,
  targetMonth,
}: {
  rawShiftsWithLinks: ShiftWithLinksForVariance[];
  rawReports: ReportForUnplannedVariance[];
  targetMonth: string;
}): ShiftVarianceRow[] {
  if (!targetMonth) return [];
  const { monthStart, monthEnd } = getJstMonthBounds(targetMonth);
  const linkedReportIds = new Set<string>();
  const rows = rawShiftsWithLinks.flatMap<ShiftVarianceRow>((shift) => {
    const fallbackStaffNames = (shift.shift_staffs ?? [])
      .map((staff) => staff.staffs?.name)
      .filter((name): name is string => Boolean(name));
    const segments = (shift.shift_segments ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    if (segments.length > 0) {
      return segments.flatMap((segment, index) => {
        const clippedSegment = clipSlotToMonth(segment.start_at, segment.end_at, monthStart, monthEnd);
        if (!clippedSegment) return [];
        const plannedH = getOverlappingHours(
          new Date(segment.start_at),
          new Date(segment.end_at),
          monthStart,
          monthEnd,
        );
        const linkedReports = (segment.reports ?? []).filter((report) => (
          report
          && !report.deleted_at
          && ['pending', 'approved', 'remanded'].includes(report.status)
        ));
        const actualMs = linkedReports.reduce((sum, report) => {
          linkedReportIds.add(report.id);
          const dataObj = report.report_values?.[0]?.data ?? null;
          return sum + getReportHours(
            dataObj,
            report.start_at,
            report.end_at,
            monthStart,
            monthEnd,
          ).totalHours * 3600000;
        }, 0);
        const actualH = actualMs > 0 ? actualMs / 3600000 : null;
        const diffH = actualH != null ? actualH - plannedH : null;
        const plannedStaffNames = (segment.shift_segment_staffs ?? [])
          .map((staff) => staff.staff?.name)
          .filter((name): name is string => Boolean(name));
        const effectivePlannedStaffs = plannedStaffNames.length > 0
          ? plannedStaffNames
          : fallbackStaffNames;
        const firstReport = linkedReports[0] ?? null;
        const firstReportData = firstReport?.report_values?.[0]?.data ?? null;
        const actualStaffNames = firstReport
          ? getReportHelperNames(firstReportData, undefined, firstReport.report_actual_staffs)
          : [];
        const plannedServiceTypeName = segment.service_type?.name ?? null;
        const actualServiceTypeName = firstReport?.actual_service_type?.name ?? null;

        return [{
          id: `segment-${segment.id}`,
          shiftId: shift.id,
          segmentId: segment.id,
          clientId: shift.client_id,
          clientName: `${shift.clients?.name ?? '—'}${plannedServiceTypeName ? ` / ${plannedServiceTypeName}` : ` / 区間${index + 1}`}`,
          staffNames: effectivePlannedStaffs.join('、') || '—',
          actualStaffNames: actualStaffNames.join('、') || '—',
          hasStaffMismatch: namesDiffer(effectivePlannedStaffs, actualStaffNames),
          actualServiceTypeName,
          hasServiceTypeMismatch: Boolean(
            actualServiceTypeName
            && plannedServiceTypeName
            && actualServiceTypeName !== plannedServiceTypeName
          ),
          startAt: clippedSegment.start_at,
          endAt: clippedSegment.end_at,
          plannedH,
          actualH,
          diffH,
          reportId: firstReport?.id ?? null,
          isUnplanned: false,
          isLegacyReport: false,
          isMonthClipped: isSlotClipped(segment.start_at, segment.end_at, clippedSegment),
        }];
      });
    }

    const clippedShift = clipSlotToMonth(shift.start_at, shift.end_at, monthStart, monthEnd);
    if (!clippedShift) return [];
    const plannedH = getOverlappingHours(
      new Date(shift.start_at),
      new Date(shift.end_at),
      monthStart,
      monthEnd,
    );
    const linked = shift.report_shifts ?? [];
    const actualMs = linked.reduce((sum, reportShift) => {
      const report = reportShift.reports;
      if (
        !report
        || report.deleted_at
        || report.segment_id
        || !['pending', 'approved', 'remanded'].includes(report.status)
      ) return sum;
      linkedReportIds.add(report.id);
      const dataObj = report.report_values?.[0]?.data ?? null;
      return sum + getReportHours(
        dataObj,
        report.start_at,
        report.end_at,
        monthStart,
        monthEnd,
      ).totalHours * 3600000;
    }, 0);
    const actualH = actualMs > 0 ? actualMs / 3600000 : null;
    const diffH = actualH != null ? actualH - plannedH : null;
    const firstReport = linked
      .map((reportShift) => reportShift.reports)
      .find((report) => report != null && !report.segment_id) ?? null;
    const actualStaffNames = firstReport
      ? getReportHelperNames(
        firstReport.report_values?.[0]?.data ?? null,
        undefined,
        firstReport.report_actual_staffs,
      )
      : [];

    return [{
      id: `shift-${shift.id}`,
      shiftId: shift.id,
      segmentId: null,
      clientId: shift.client_id,
      clientName: shift.clients?.name ?? '—',
      staffNames: fallbackStaffNames.join('、') || '—',
      actualStaffNames: actualStaffNames.join('、') || '—',
      hasStaffMismatch: namesDiffer(fallbackStaffNames, actualStaffNames),
      actualServiceTypeName: firstReport?.actual_service_type?.name ?? null,
      hasServiceTypeMismatch: false,
      startAt: clippedShift.start_at,
      endAt: clippedShift.end_at,
      plannedH,
      actualH,
      diffH,
      reportId: firstReport?.id ?? null,
      isUnplanned: false,
      isLegacyReport: false,
      isMonthClipped: isSlotClipped(shift.start_at, shift.end_at, clippedShift),
    }];
  });

  rawReports.forEach((report) => {
    const hasLink = Boolean(report.segment_id) || linkedReportIds.has(report.id);
    if (hasLink) return;

    const dataObj = report.report_values?.[0]?.data;
    const clippedReport = clipSlotToMonth(report.start_at, report.end_at, monthStart, monthEnd);
    const actualH = getReportHours(
      dataObj ?? null,
      report.start_at,
      report.end_at,
      monthStart,
      monthEnd,
    ).totalHours;
    if (actualH <= 0) return;

    const helpers = Array.isArray(dataObj?._helpers)
      ? dataObj._helpers.map(String).filter(Boolean)
      : [];
    const actualStaffNames = getReportHelperNames(dataObj ?? null, undefined, report.report_actual_staffs);
    const fallbackHelper = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper?.name;
    const displayStaffNames = actualStaffNames.length > 0
      ? actualStaffNames.join('、')
      : helpers.length > 0
        ? helpers.join('、')
        : fallbackHelper || '未設定(担当者不明)';

    rows.push({
      id: `unplanned-report-${report.id}`,
      shiftId: null,
      segmentId: null,
      clientId: report.client_id,
      clientName: Array.isArray(report.clients) ? report.clients[0]?.name ?? '—' : report.clients?.name ?? '—',
      staffNames: displayStaffNames,
      actualStaffNames: displayStaffNames,
      hasStaffMismatch: false,
      actualServiceTypeName: report.actual_service_type?.name ?? null,
      hasServiceTypeMismatch: false,
      startAt: clippedReport?.start_at ?? report.start_at,
      endAt: clippedReport?.end_at ?? report.end_at,
      plannedH: null,
      actualH,
      diffH: actualH,
      reportId: report.id,
      isUnplanned: true,
      isLegacyReport: (report.report_shifts ?? []).length > 0,
      isMonthClipped: isSlotClipped(report.start_at, report.end_at, clippedReport),
    });
  });

  return rows.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

export function buildStatisticsCsv(
  rows: AggregatedRow[],
  premiumComparisonPerStaff: Record<string, PremiumComparison>,
  premiumTypes: LaborPremiumType[],
  tabIndex: number,
): string {
  const premiumHeaders = tabIndex === 0
    ? premiumTypes.flatMap((type) => [`${type.name}予定(h)`, `${type.name}実績(h)`, `${type.name}差異(h)`])
    : [];
  const header = [
    '氏名',
    '予定時間(h)',
    '実績時間(h)',
    'サービス(h)',
    '移動(h)',
    '内勤(h)',
    '差異(h)',
    `${getReportStatusLabel('pending')}件数`,
    `${getReportStatusLabel('remanded')}件数`,
    ...premiumHeaders,
  ];
  const csvRows = rows.map((row) => {
    const premiumCells = tabIndex === 0
      ? premiumTypes.flatMap((type) => {
        const premium = premiumComparisonPerStaff[row.name]?.[type.id]
          ?? { planned: 0, actual: 0, diff: 0 };
        return [
          (premium.planned / 60).toFixed(2),
          (premium.actual / 60).toFixed(2),
          (premium.diff / 60).toFixed(2),
        ];
      })
      : [];
    return [
      `"${row.name}"`,
      row.plannedHours.toFixed(2),
      row.actualHours.toFixed(2),
      row.serviceHours.toFixed(2),
      row.travelHours.toFixed(2),
      row.internalHours.toFixed(2),
      (row.actualHours - row.plannedHours).toFixed(2),
      row.statusCounts.pending,
      row.statusCounts.remanded,
      ...premiumCells,
    ];
  });

  return '\uFEFF' + [header.join(','), ...csvRows.map((row) => row.join(','))].join('\n');
}
