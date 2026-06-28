'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Tabs, Tab, Stack, Button,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, Collapse, Divider
} from '@/components/ui/mui';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import EditNoteIcon from '@mui/icons-material/EditNote';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useRouter } from 'next/navigation';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { MonthField } from '@/components/ui';
import { aggregatePremiumMinutes, type LaborPremiumType } from '@/utils/laborPremium';
import { type InternalWorkRecord } from '@/app/actions/internalWork';
import { getStatisticsData } from '@/app/actions/statistics';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';

type ShiftStaffData = { staff_id: string; staffs: { name: string } | null; };
type ShiftData = { 
    id: string; start_at: string; end_at: string; status: string; client_id: string; 
    clients: { name: string } | null; shift_staffs: ShiftStaffData[]; 
};

type ReportData = { 
    id: string; start_at: string; end_at: string; status: string; client_id: string; 
    clients: { name: string } | null; 
    helper?: { name: string } | null;
    report_values: { data: ReportValuesData }[] | null; 
    report_shifts?: { shift_id: string }[] | null;
};

type ReportValuesData = { _helpers?: string[]; service_time?: string|number; travel_time?: string|number; };
type StatusCounts = { pending: number; remanded: number };
type AggregatedRow = { name: string; plannedHours: number; actualHours: number; serviceHours: number; travelHours: number; internalHours: number; statusCounts: StatusCounts; };
type PremiumComparison = Record<string, { planned: number; actual: number; diff: number }>;
type StaffDetailItem = {
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

type ShiftWithLinks = {
    id: string; start_at: string; end_at: string; client_id: string;
    clients: { name: string } | null;
    shift_staffs: Array<{ staffs: { name: string } | null }>;
    report_shifts: Array<{ is_primary: boolean; reports: { id: string; start_at: string; end_at: string; status: string; report_values?: { data: ReportValuesData }[] | null } | null }>;
};

type ShiftVarianceRow = {
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
    isUnplanned: boolean;
    isMonthClipped: boolean;
};

function getOverlappingHours(start: Date, end: Date, monthStart: Date, monthEnd: Date): number {
    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd = end < monthEnd ? end : monthEnd;
    if (overlapStart >= overlapEnd) return 0;
    return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
}

function clipSlotToMonth(startAt: string, endAt: string, monthStart: Date, monthEnd: Date): { start_at: string; end_at: string } | null {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd = end < monthEnd ? end : monthEnd;
    if (overlapStart >= overlapEnd) return null;
    return { start_at: overlapStart.toISOString(), end_at: overlapEnd.toISOString() };
}

function isSlotClipped(startAt: string, endAt: string, clipped: { start_at: string; end_at: string } | null): boolean {
    if (!clipped) return false;
    return clipped.start_at !== new Date(startAt).toISOString() || clipped.end_at !== new Date(endAt).toISOString();
}

function formatDetailDateTime(value: string): string {
    return new Date(value).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getReportHours(dataObj: ReportValuesData | null, startAt: string, endAt: string, monthStart?: Date, monthEnd?: Date) {
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

export default function StatisticsPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [targetMonth, setTargetMonth] = useState<string>(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [tabIndex, setTabIndex] = useState(0); 

    const [rawShifts, setRawShifts] = useState<ShiftData[]>([]);
    const [rawReports, setRawReports] = useState<ReportData[]>([]);
    const [premiumTypes, setPremiumTypes] = useState<LaborPremiumType[]>([]);
    const [rawShiftsWithLinks, setRawShiftsWithLinks] = useState<ShiftWithLinks[]>([]);
    const [internalWorkRecords, setInternalWorkRecords] = useState<InternalWorkRecord[]>([]);
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

    const fetchStatisticsData = useCallback(async () => {
        if (!currentOrg || !targetMonth) return;
        setLoading(true);

        try {
            const [yearStr, monthStr] = targetMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10) - 1;

            const monthStart = new Date(year, month, 1, 0, 0, 0);
            const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

            const shiftStartRange = new Date(monthStart.getTime() - (24 * 60 * 60 * 1000)).toISOString();
            const shiftEndRange = new Date(monthEnd.getTime() + (24 * 60 * 60 * 1000)).toISOString();

            const data = await getStatisticsData(currentOrg.id, shiftStartRange, shiftEndRange);
            setRawShifts(data.shifts as ShiftData[]);
            setRawReports(data.reports as ReportData[]);
            setInternalWorkRecords(data.internalWorkRecords as InternalWorkRecord[]);
            setPremiumTypes(data.premiumTypes as LaborPremiumType[]);
            setRawShiftsWithLinks(data.shiftsWithLinks as ShiftWithLinks[]);
        } catch (error) {
            console.error('Statistics fetch failed', error);
            showToast(error instanceof Error ? `データの取得に失敗しました: ${error.message}` : 'データの取得に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    }, [currentOrg, targetMonth, showToast]);

    useEffect(() => {
        if (!wsLoading && currentOrg) fetchStatisticsData();
    }, [wsLoading, currentOrg, fetchStatisticsData]);

    const aggregatedData = useMemo(() => {
        if (!targetMonth) {
            return {
                rows: [] as AggregatedRow[],
                premiumComparisonPerStaff: {} as Record<string, PremiumComparison>,
                detailItemsPerStaff: {} as Record<string, StaffDetailItem[]>,
            };
        }

        const [yearStr, monthStr] = targetMonth.split('-');
        const monthStart = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1, 0, 0, 0);
        const monthEnd = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0, 23, 59, 59, 999);

        const statsMap: Record<string, AggregatedRow> = {};
        const staffShiftsMap: Record<string, Array<{ start_at: string; end_at: string }>> = {};
        const staffReportsMap: Record<string, Array<{ start_at: string; end_at: string }>> = {};
        const detailItemsPerStaff: Record<string, StaffDetailItem[]> = {};

        const addHours = (name: string, type: 'planned' | 'actual', hours: number, breakdown?: Partial<Pick<AggregatedRow, 'serviceHours' | 'travelHours' | 'internalHours'>>) => {
            if (!name) return;
            if (!statsMap[name]) statsMap[name] = { name, plannedHours: 0, actualHours: 0, serviceHours: 0, travelHours: 0, internalHours: 0, statusCounts: { pending: 0, remanded: 0 } };
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

        // ① 単発シフトの集計 (予定時間・予定割増)
        rawShifts.forEach(shift => {
            const shiftStart = new Date(shift.start_at);
            const shiftEnd = new Date(shift.end_at);
            const hours = getOverlappingHours(shiftStart, shiftEnd, monthStart, monthEnd);
            const clipped = clipSlotToMonth(shift.start_at, shift.end_at, monthStart, monthEnd);
            const isClipped = isSlotClipped(shift.start_at, shift.end_at, clipped);
                
            if (hours > 0) {
                if (tabIndex === 1 && shift.clients?.name) {
                    const clientName = Array.isArray(shift.clients) ? shift.clients[0]?.name : shift.clients.name;
                    addHours(clientName, 'planned', hours);
                }
                if (tabIndex === 0) {
                    const clientName = Array.isArray(shift.clients) ? shift.clients[0]?.name : shift.clients?.name;
                    if (shift.shift_staffs && shift.shift_staffs.length > 0) {
                        shift.shift_staffs.forEach(staff => {
                            const sName = Array.isArray(staff.staffs) ? staff.staffs[0]?.name : staff.staffs?.name;
                            const targetName = sName || '未設定(スタッフ名なし)';
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
                        addHours('未設定(シフト担当者なし)', 'planned', hours);
                        if (clipped) addStaffSlot(staffShiftsMap, '未設定(シフト担当者なし)', clipped.start_at, clipped.end_at);
                        addDetailItem('未設定(シフト担当者なし)', {
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
                }
            }
        });

        // ② 実績（記録）の集計 (実績時間)
        rawReports.forEach(report => {
            const dataObj = (report.report_values && report.report_values.length > 0) ? report.report_values[0].data : null;
            const { serviceHours, travelHours, totalHours: actualHours } = getReportHours(dataObj, report.start_at, report.end_at, monthStart, monthEnd);

            if (actualHours > 0) {
                if (tabIndex === 1 && report.clients?.name) {
                    const clientName = Array.isArray(report.clients) ? report.clients[0]?.name : report.clients.name;
                    addHours(clientName, 'actual', actualHours, { serviceHours, travelHours });
                    addStatusCount(clientName, report.status);
                }
                if (tabIndex === 0) {
                    const actualHelpers = dataObj?._helpers || [];
                    const clipped = clipSlotToMonth(report.start_at, report.end_at, monthStart, monthEnd);
                    const linkedShiftId = report.report_shifts?.[0]?.shift_id ?? null;
                    const clientName = Array.isArray(report.clients) ? report.clients[0]?.name : report.clients?.name;
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

                    if (Array.isArray(actualHelpers) && actualHelpers.length > 0) {
                        actualHelpers.forEach(helperName => {
                            if (helperName) {
                                addActualForStaff(String(helperName));
                            }
                        });
                    } else if (report.helper?.name) {
                        // 古いデータなどで _helpers がない場合のフォールバック
                        const fallbackName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper.name;
                        if (fallbackName) {
                            addActualForStaff(fallbackName);
                        }
                    } else {
                        addHours('未設定(担当者不明)', 'actual', actualHours);
                        addStatusCount('未設定(担当者不明)', report.status);
                        if (clipped) addStaffSlot(staffReportsMap, '未設定(担当者不明)', clipped.start_at, clipped.end_at);
                        addDetailItem('未設定(担当者不明)', {
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
            }
        });

        if (tabIndex === 0) {
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
        if (tabIndex === 0) {
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
    }, [rawShifts, rawReports, internalWorkRecords, targetMonth, tabIndex, premiumTypes]);

    const shiftVarianceRows = useMemo<ShiftVarianceRow[]>(() => {
        if (!targetMonth) return [];
        const [yearStr, monthStr] = targetMonth.split('-');
        const monthStart = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1, 0, 0, 0);
        const monthEnd = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0, 23, 59, 59, 999);
        const linkedReportIds = new Set<string>();
        const rows: ShiftVarianceRow[] = rawShiftsWithLinks.flatMap(shift => {
            const clippedShift = clipSlotToMonth(shift.start_at, shift.end_at, monthStart, monthEnd);
            if (!clippedShift) return [];
            const plannedH = getOverlappingHours(new Date(shift.start_at), new Date(shift.end_at), monthStart, monthEnd);
            const linked = shift.report_shifts ?? [];
            const actualMs = linked.reduce((sum, rs) => {
                const r = rs.reports;
                if (!r || !['pending', 'approved', 'remanded'].includes(r.status)) return sum;
                linkedReportIds.add(r.id);
                const dataObj = r.report_values?.[0]?.data ?? null;
                return sum + getReportHours(dataObj, r.start_at, r.end_at, monthStart, monthEnd).totalHours * 3600000;
            }, 0);
            const actualH = actualMs > 0 ? actualMs / 3600000 : null;
            const diffH = actualH != null ? actualH - plannedH : null;
            const staffNames = (shift.shift_staffs ?? []).map(s => s.staffs?.name).filter(Boolean).join('、');
            const firstReport = linked.find(rs => rs.reports != null);

            return [{
                id: `shift-${shift.id}`,
                shiftId: shift.id,
                clientId: shift.client_id,
                clientName: shift.clients?.name ?? '—',
                staffNames: staffNames || '—',
                startAt: clippedShift.start_at,
                endAt: clippedShift.end_at,
                plannedH,
                actualH,
                diffH,
                reportId: firstReport?.reports?.id ?? null,
                isUnplanned: false,
                isMonthClipped: isSlotClipped(shift.start_at, shift.end_at, clippedShift),
            }];
        });

        rawReports.forEach(report => {
            const hasLink = (report.report_shifts ?? []).length > 0 || linkedReportIds.has(report.id);
            if (hasLink) return;

            const dataObj = report.report_values?.[0]?.data;
            const clippedReport = clipSlotToMonth(report.start_at, report.end_at, monthStart, monthEnd);
            const actualH = getReportHours(dataObj ?? null, report.start_at, report.end_at, monthStart, monthEnd).totalHours;
            if (actualH <= 0) return;

            const helpers = Array.isArray(dataObj?._helpers)
                ? dataObj._helpers.map(String).filter(Boolean)
                : [];
            const fallbackHelper = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper?.name;

            rows.push({
                id: `unplanned-report-${report.id}`,
                shiftId: null,
                clientId: report.client_id,
                clientName: report.clients?.name ?? '—',
                staffNames: helpers.length > 0 ? helpers.join('、') : fallbackHelper || '未設定(担当者不明)',
                startAt: clippedReport?.start_at ?? report.start_at,
                endAt: clippedReport?.end_at ?? report.end_at,
                plannedH: null,
                actualH,
                diffH: actualH,
                reportId: report.id,
                isUnplanned: true,
                isMonthClipped: isSlotClipped(report.start_at, report.end_at, clippedReport),
            });
        });

        return rows.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }, [rawShiftsWithLinks, rawReports, targetMonth]);

    const aggregatedTotals = useMemo(() => {
        return aggregatedData.rows.reduce(
            (total, row) => ({
                plannedHours: total.plannedHours + row.plannedHours,
                actualHours: total.actualHours + row.actualHours,
                serviceHours: total.serviceHours + row.serviceHours,
                travelHours: total.travelHours + row.travelHours,
                internalHours: total.internalHours + row.internalHours,
                pending: total.pending + row.statusCounts.pending,
                remanded: total.remanded + row.statusCounts.remanded,
            }),
            { plannedHours: 0, actualHours: 0, serviceHours: 0, travelHours: 0, internalHours: 0, pending: 0, remanded: 0 },
        );
    }, [aggregatedData.rows]);

    const premiumTotals = useMemo(() => {
        if (tabIndex !== 0) return {} as PremiumComparison;
        return premiumTypes.reduce((totals, type) => {
            const total = aggregatedData.rows.reduce((sum, row) => {
                const premium = aggregatedData.premiumComparisonPerStaff[row.name]?.[type.id] ?? { planned: 0, actual: 0, diff: 0 };
                return {
                    planned: sum.planned + premium.planned,
                    actual: sum.actual + premium.actual,
                    diff: sum.diff + premium.diff,
                };
            }, { planned: 0, actual: 0, diff: 0 });
            totals[type.id] = total;
            return totals;
        }, {} as PremiumComparison);
    }, [aggregatedData.premiumComparisonPerStaff, aggregatedData.rows, premiumTypes, tabIndex]);

    const shiftVarianceTotals = useMemo(() => {
        return shiftVarianceRows.reduce(
            (total, row) => ({
                plannedH: total.plannedH + (row.plannedH ?? 0),
                actualH: total.actualH + (row.actualH ?? 0),
            }),
            { plannedH: 0, actualH: 0 },
        );
    }, [shiftVarianceRows]);

    const getRecordHref = (row: ShiftVarianceRow) => (
        row.reportId
            ? `/app/record/${row.clientId}?reportId=${row.reportId}`
            : row.shiftId
                ? `/app/record/${row.clientId}?shiftId=${row.shiftId}`
                : null
    );

    const getShiftHref = (row: ShiftVarianceRow) => (
        row.shiftId
            ? `/app/shifts/manage?shiftId=${row.shiftId}&start=${encodeURIComponent(row.startAt)}&month=${targetMonth}`
            : null
    );

    const getDetailRecordHref = (item: StaffDetailItem) => (
        item.reportId && item.clientId
            ? `/app/record/${item.clientId}?reportId=${item.reportId}`
            : item.shiftId && item.clientId
                ? `/app/record/${item.clientId}?shiftId=${item.shiftId}`
                : null
    );

    const getDetailShiftHref = (item: StaffDetailItem) => (
        item.shiftId
            ? `/app/shifts/manage?shiftId=${item.shiftId}&start=${encodeURIComponent(item.startAt)}&month=${targetMonth}`
            : null
    );

    const handleExportCSV = () => {
        const { rows: aggRows, premiumComparisonPerStaff } = aggregatedData;
        const premiumHeaders = tabIndex === 0 ? premiumTypes.flatMap(t => [`${t.name}予定(h)`, `${t.name}実績(h)`, `${t.name}差異(h)`]) : [];
        const header = ['氏名', '予定時間(h)', '実績時間(h)', 'サービス(h)', '移動(h)', '内勤(h)', '差異(h)', `${getReportStatusLabel('pending')}件数`, `${getReportStatusLabel('remanded')}件数`, ...premiumHeaders];
        const csvRows = aggRows.map(row => {
            const premiumCells = tabIndex === 0
                ? premiumTypes.flatMap(t => {
                    const premium = premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
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

        const csvContent = '\uFEFF' + [header.join(','), ...csvRows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `稼働集計_${targetMonth}_${tabIndex === 0 ? 'スタッフ別' : '利用者別'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 2, sm: 3 }, pt: 2, flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <AssessmentIcon color="action" />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">統計・予実管理</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="scrollable" allowScrollButtonsMobile>
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                    <Tab label="シフト差異" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} spacing={2}>
                    <MonthField label="対象月" size="small" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} sx={{ minWidth: { xs: 0, sm: 200 } }} />
                    {tabIndex < 2 && <Button variant="outlined" color="primary" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={loading || aggregatedData.rows.length === 0} sx={{ bgcolor: 'background.paper' }}>CSVダウンロード</Button>}
                </Stack>

                {tabIndex < 2 && !loading && (
                    <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, borderRadius: 2, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 2 }} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
                            <Box>
                                <Typography variant="subtitle2" fontWeight="bold">{tabIndex === 0 ? '全職員合計' : '全利用者合計'}</Typography>
                                <Typography variant="caption" color="text.secondary">選択月に重なる時間だけで集計しています</Typography>
                            </Box>
                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                <Chip size="small" color="default" variant="outlined" label={`予定 ${aggregatedTotals.plannedHours.toFixed(2)}h`} />
                                <Chip size="small" color="primary" label={`実績 ${aggregatedTotals.actualHours.toFixed(2)}h`} />
                                <Chip
                                    size="small"
                                    color={Math.abs(aggregatedTotals.actualHours - aggregatedTotals.plannedHours) >= 0.01 ? 'warning' : 'default'}
                                    variant="outlined"
                                    label={`差異 ${(aggregatedTotals.actualHours - aggregatedTotals.plannedHours) >= 0 ? '+' : ''}${(aggregatedTotals.actualHours - aggregatedTotals.plannedHours).toFixed(2)}h`}
                                />
                                <Chip size="small" variant="outlined" label={`サービス ${aggregatedTotals.serviceHours.toFixed(1)}h`} />
                                <Chip size="small" variant="outlined" label={`移動 ${aggregatedTotals.travelHours.toFixed(1)}h`} />
                                {tabIndex === 0 && aggregatedTotals.internalHours > 0 && <Chip size="small" variant="outlined" label={`内勤 ${aggregatedTotals.internalHours.toFixed(1)}h`} />}
                                {tabIndex === 0 && premiumTypes.map((type) => {
                                    const premium = premiumTotals[type.id] ?? { planned: 0, actual: 0, diff: 0 };
                                    return (
                                        <Chip
                                            key={type.id}
                                            size="small"
                                            variant="outlined"
                                            color={Math.abs(premium.diff / 60) >= 0.1 ? 'warning' : 'default'}
                                            label={`${type.name} ${((premium.planned) / 60).toFixed(1)} / ${(premium.actual / 60).toFixed(1)} / ${(premium.diff / 60) >= 0 ? '+' : ''}${(premium.diff / 60).toFixed(1)}h`}
                                        />
                                    );
                                })}
                            </Stack>
                        </Stack>
                    </Paper>
                )}

                <Paper sx={{ p: 0, minHeight: 400, borderRadius: 1, overflow: 'hidden', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                    {loading ? <Box display="flex" justifyContent="center" alignItems="center" height={300}><CircularProgress /></Box> : (
                        tabIndex < 2 ? (
                        <>
                        <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, bgcolor: 'background.tint', borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                                <Typography variant="subtitle2" fontWeight="bold">{tabIndex === 0 ? 'スタッフ別明細' : '利用者別明細'}</Typography>
                            </Stack>
                        </Box>
                        <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
                            <Table>
                                <TableHead sx={{ bgcolor: 'background.tint' }}>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{tabIndex === 0 ? 'スタッフ名' : '利用者名'}</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績時間 (h)</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>実績内訳</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異 (h)</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>状態</TableCell>
                                        {tabIndex === 0 && premiumTypes.map(t => (
                                            <TableCell key={t.id} align="right" sx={{ fontWeight: 'bold' }}>{t.name}<br />予定/実績/差異(h)</TableCell>
                                        ))}
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {aggregatedData.rows.length === 0 ? <TableRow><TableCell colSpan={6 + (tabIndex === 0 ? premiumTypes.length : 0)} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow> : (
                                        aggregatedData.rows.map((row) => {
                                            const diff = row.actualHours - row.plannedHours;
                                            const premiumDiff = premiumTypes.some(t => Math.abs(aggregatedData.premiumComparisonPerStaff[row.name]?.[t.id]?.diff ?? 0) >= 1);
                                            const hasDiff = Math.abs(diff) >= 0.01 || premiumDiff;
                                            const isExpanded = Boolean(expandedRows[row.name]);
                                            const isAlert = diff < -2 || diff > 2 || premiumDiff;
                                            return (
                                                <React.Fragment key={row.name}>
                                                    <TableRow hover>
                                                        <TableCell sx={{ fontWeight: 'bold' }}>
                                                            <Stack direction="row" spacing={0.5} alignItems="center">
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={!hasDiff}
                                                                    onClick={() => setExpandedRows(prev => ({ ...prev, [row.name]: !prev[row.name] }))}
                                                                    aria-label={isExpanded ? '差異詳細を閉じる' : '差異詳細を開く'}
                                                                >
                                                                    {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                                                                </IconButton>
                                                                <Typography fontWeight="bold">{row.name}</Typography>
                                                            </Stack>
                                                        </TableCell>
                                                        <TableCell align="right">{row.plannedHours.toFixed(2)}</TableCell>
                                                        <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>{row.actualHours.toFixed(2)}</TableCell>
                                                        <TableCell>
                                                            <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="flex-start">
                                                                <Chip size="small" variant="outlined" label={`サービス ${row.serviceHours.toFixed(1)}h`} />
                                                                <Chip size="small" variant="outlined" label={`移動 ${row.travelHours.toFixed(1)}h`} />
                                                                {tabIndex === 0 && row.internalHours > 0 && <Chip size="small" variant="outlined" label={`内勤 ${row.internalHours.toFixed(1)}h`} />}
                                                            </Stack>
                                                        </TableCell>
                                                        <TableCell align="right" sx={{ color: isAlert ? 'error.main' : 'inherit', fontWeight: isAlert ? 'bold' : 'normal' }}>{diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</TableCell>
                                                        <TableCell>
                                                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                                                {row.statusCounts.pending > 0 && <Chip size="small" color={getReportStatusChipColor('pending')} label={`${getReportStatusLabel('pending')}あり ${row.statusCounts.pending}`} />}
                                                                {row.statusCounts.remanded > 0 && <Chip size="small" color={getReportStatusChipColor('remanded')} label={`${getReportStatusLabel('remanded')}あり ${row.statusCounts.remanded}`} />}
                                                                {row.statusCounts.pending === 0 && row.statusCounts.remanded === 0 && <Typography variant="caption" color="text.secondary">—</Typography>}
                                                            </Stack>
                                                        </TableCell>
                                                        {tabIndex === 0 && premiumTypes.map(t => {
                                                            const premium = aggregatedData.premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
                                                            const diffHours = premium.diff / 60;
                                                            return (
                                                                <TableCell key={t.id} align="right" sx={{ color: Math.abs(diffHours) >= 0.1 ? 'error.main' : 'inherit' }}>
                                                                    {(premium.planned / 60).toFixed(1)} / {(premium.actual / 60).toFixed(1)} / {diffHours >= 0 ? '+' : ''}{diffHours.toFixed(1)}
                                                                </TableCell>
                                                            );
                                                        })}
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell colSpan={6 + (tabIndex === 0 ? premiumTypes.length : 0)} sx={{ p: 0, borderBottom: isExpanded ? undefined : 0 }}>
                                                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                                                <Box sx={{ px: 3, py: 2, bgcolor: 'background.tint' }}>
                                                                    <Typography variant="subtitle2" fontWeight="bold" mb={1}>差異対象シフト・実績</Typography>
                                                                    <Stack spacing={1}>
                                                                        {(aggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => {
                                                                            const recordHref = getDetailRecordHref(item);
                                                                            const shiftHref = getDetailShiftHref(item);
                                                                            return (
                                                                                <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: '90px minmax(180px, 1fr) 110px minmax(180px, auto)', gap: 1, alignItems: 'center' }}>
                                                                                    <Chip size="small" label={item.kind === 'planned' ? '予定' : item.kind === 'internal' ? '内勤' : '実績'} color={item.kind === 'planned' ? 'default' : item.kind === 'internal' ? 'default' : 'primary'} variant={item.kind === 'planned' ? 'outlined' : 'filled'} />
                                                                                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                                                                        {item.clientName} {formatDetailDateTime(item.startAt)} - {formatDetailDateTime(item.endAt)}
                                                                                        {item.isMonthClipped && <Chip size="small" label="月内分" variant="outlined" sx={{ ml: 1 }} />}
                                                                                    </Typography>
                                                                                    <Typography variant="body2" align="right">{item.hours.toFixed(2)}h</Typography>
                                                                                    <Stack direction="row" spacing={0.75} justifyContent="flex-end" useFlexGap flexWrap="wrap">
                                                                                        {recordHref && (
                                                                                            <Button size="small" variant={item.reportId ? 'outlined' : 'contained'} startIcon={<EditNoteIcon />} href={recordHref} component="a">
                                                                                                {item.reportId ? '実績確認' : '実績作成'}
                                                                                            </Button>
                                                                                        )}
                                                                                        {shiftHref && (
                                                                                            <Button size="small" variant="outlined" color="inherit" startIcon={<EventNoteIcon />} href={shiftHref} component="a">
                                                                                                シフト確認
                                                                                            </Button>
                                                                                        )}
                                                                                    </Stack>
                                                                                </Box>
                                                                            );
                                                                        })}
                                                                    </Stack>
                                                                </Box>
                                                            </Collapse>
                                                        </TableCell>
                                                    </TableRow>
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, p: 1.5 }}>
                            {aggregatedData.rows.length === 0 ? (
                                <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>データがありません</Box>
                            ) : aggregatedData.rows.map((row, i) => {
                                const diff = row.actualHours - row.plannedHours;
                                const premiumDiff = premiumTypes.some(t => Math.abs(aggregatedData.premiumComparisonPerStaff[row.name]?.[t.id]?.diff ?? 0) >= 1);
                                const hasDiff = Math.abs(diff) >= 0.01 || premiumDiff;
                                const isExpanded = Boolean(expandedRows[row.name]);
                                const isAlert = diff < -2 || diff > 2 || premiumDiff;
                                return (
                                    <Box key={i} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
                                        <Stack direction="row" alignItems="center" spacing={0.5}>
                                            <IconButton
                                                size="small"
                                                disabled={!hasDiff}
                                                onClick={() => setExpandedRows(prev => ({ ...prev, [row.name]: !prev[row.name] }))}
                                                aria-label={isExpanded ? '差異詳細を閉じる' : '差異詳細を開く'}
                                            >
                                                {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                                            </IconButton>
                                            <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.name}</Typography>
                                        </Stack>
                                        <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1} mt={1.5}>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">予定</Typography>
                                                <Typography fontWeight="bold">{row.plannedHours.toFixed(2)}h</Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">実績</Typography>
                                                <Typography fontWeight="bold" color="primary.main">{row.actualHours.toFixed(2)}h</Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">差異</Typography>
                                                <Typography fontWeight={isAlert ? 'bold' : 'normal'} color={isAlert ? 'error.main' : 'text.primary'}>
                                                    {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}h
                                                </Typography>
                                            </Box>
                                        </Box>
                                        <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5}>
                                            <Chip size="small" variant="outlined" label={`サービス ${row.serviceHours.toFixed(1)}h`} />
                                            <Chip size="small" variant="outlined" label={`移動 ${row.travelHours.toFixed(1)}h`} />
                                            {tabIndex === 0 && row.internalHours > 0 && <Chip size="small" variant="outlined" label={`内勤 ${row.internalHours.toFixed(1)}h`} />}
                                            {row.statusCounts.pending > 0 && <Chip size="small" color={getReportStatusChipColor('pending')} label={`${getReportStatusLabel('pending')}あり ${row.statusCounts.pending}`} />}
                                            {row.statusCounts.remanded > 0 && <Chip size="small" color={getReportStatusChipColor('remanded')} label={`${getReportStatusLabel('remanded')}あり ${row.statusCounts.remanded}`} />}
                                        </Stack>
                                        {tabIndex === 0 && premiumTypes.length > 0 && (
                                            <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5}>
                                                {premiumTypes.map(t => {
                                                    const premium = aggregatedData.premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
                                                    const diffHours = premium.diff / 60;
                                                    return (
                                                        <Chip
                                                            key={t.id}
                                                            size="small"
                                                            variant="outlined"
                                                            color={Math.abs(diffHours) >= 0.1 ? 'error' : 'default'}
                                                            label={`${t.name}: ${(premium.planned / 60).toFixed(1)} / ${(premium.actual / 60).toFixed(1)} / ${diffHours >= 0 ? '+' : ''}${diffHours.toFixed(1)}h`}
                                                        />
                                                    );
                                                })}
                                            </Stack>
                                        )}
                                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                            <Divider sx={{ my: 1.5 }} />
                                            <Stack spacing={1}>
                                                {(aggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => {
                                                    const recordHref = getDetailRecordHref(item);
                                                    const shiftHref = getDetailShiftHref(item);
                                                    return (
                                                        <Box key={item.id}>
                                                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                                                <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                                                                    <Chip size="small" label={item.kind === 'planned' ? '予定' : item.kind === 'internal' ? '内勤' : '実績'} color={item.kind === 'planned' ? 'default' : item.kind === 'internal' ? 'default' : 'primary'} variant={item.kind === 'planned' ? 'outlined' : 'filled'} />
                                                                    {item.isMonthClipped && <Chip size="small" label="月内分" variant="outlined" />}
                                                                </Stack>
                                                                <Typography variant="body2" fontWeight="bold">{item.hours.toFixed(2)}h</Typography>
                                                            </Stack>
                                                            <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                                                                {item.clientName} {formatDetailDateTime(item.startAt)} - {formatDetailDateTime(item.endAt)}
                                                            </Typography>
                                                            {(recordHref || shiftHref) && (
                                                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" mt={1}>
                                                                    {recordHref && (
                                                                        <Button size="small" variant={item.reportId ? 'outlined' : 'contained'} startIcon={<EditNoteIcon />} href={recordHref} component="a">
                                                                            {item.reportId ? '実績確認' : '実績作成'}
                                                                        </Button>
                                                                    )}
                                                                    {shiftHref && (
                                                                        <Button size="small" variant="outlined" color="inherit" startIcon={<EventNoteIcon />} href={shiftHref} component="a">
                                                                            シフト確認
                                                                        </Button>
                                                                    )}
                                                                </Stack>
                                                            )}
                                                        </Box>
                                                    );
                                                })}
                                            </Stack>
                                        </Collapse>
                                    </Box>
                                );
                            })}
                        </Stack>
                        </>
                        ) : (
                        <>
                        <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, bgcolor: 'background.tint', borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                                <Typography variant="subtitle2" fontWeight="bold">シフト差異合計</Typography>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                    <Chip size="small" color="default" variant="outlined" label={`予定 ${shiftVarianceTotals.plannedH.toFixed(1)}h`} />
                                    <Chip size="small" color="primary" label={`実績 ${shiftVarianceTotals.actualH.toFixed(1)}h`} />
                                    <Chip
                                        size="small"
                                        color={Math.abs(shiftVarianceTotals.actualH - shiftVarianceTotals.plannedH) >= 0.1 ? 'warning' : 'default'}
                                        variant="outlined"
                                        label={`差異 ${(shiftVarianceTotals.actualH - shiftVarianceTotals.plannedH) >= 0 ? '+' : ''}${(shiftVarianceTotals.actualH - shiftVarianceTotals.plannedH).toFixed(1)}h`}
                                    />
                                </Stack>
                            </Stack>
                        </Box>
                        <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
                            <Table size="small">
                                <TableHead sx={{ bgcolor: 'background.tint' }}>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>シフト日時</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>利用者名</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>担当職員</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定(h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績(h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異(h)</TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>操作</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {shiftVarianceRows.length === 0 ? (
                                        <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow>
                                    ) : shiftVarianceRows.map(row => {
                                        const startStr = new Date(row.startAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                        const endStr = row.endAt ? new Date(row.endAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
                                        const recordHref = getRecordHref(row);
                                        const shiftHref = getShiftHref(row);
                                        return (
                                            <TableRow
                                                key={row.id}
                                                hover={Boolean(recordHref)}
                                                onClick={() => {
                                                    if (recordHref) router.push(recordHref);
                                                }}
                                                sx={{ cursor: recordHref ? 'pointer' : 'default' }}
                                            >
                                                <TableCell>
                                                    <Stack direction="row" spacing={1} alignItems="center">
                                                        <Typography variant="body2">{endStr ? `${startStr} - ${endStr}` : startStr}</Typography>
                                                        {row.isUnplanned && <Chip label="予定なし" size="small" color="default" variant="outlined" />}
                                                        {row.isMonthClipped && <Chip label="月内分" size="small" variant="outlined" />}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>{row.clientName}</TableCell>
                                                <TableCell>{row.staffNames}</TableCell>
                                                <TableCell align="right">{row.plannedH != null ? row.plannedH.toFixed(1) : '—'}</TableCell>
                                                <TableCell align="right">{row.actualH != null ? row.actualH.toFixed(1) : '—'}</TableCell>
                                                <TableCell align="right" sx={{ color: row.diffH != null && row.diffH < -0.1 ? 'error.main' : 'inherit', fontWeight: row.diffH != null && row.diffH < -0.1 ? 'bold' : 'normal' }}>
                                                    {row.diffH != null ? (row.diffH >= 0 ? '+' : '') + row.diffH.toFixed(1) : '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                                                        {recordHref ? (
                                                            <Button
                                                                size="small"
                                                                variant={row.reportId ? 'outlined' : 'contained'}
                                                                startIcon={<EditNoteIcon />}
                                                                href={recordHref}
                                                                component="a"
                                                                onClick={(event) => event.stopPropagation()}
                                                            >
                                                                {row.reportId ? '実績確認' : '実績作成'}
                                                            </Button>
                                                        ) : (
                                                            <Chip label="実績なし" size="small" color="warning" variant="outlined" />
                                                        )}
                                                        {shiftHref && (
                                                            <Button
                                                                size="small"
                                                                variant="outlined"
                                                                color="inherit"
                                                                startIcon={<EventNoteIcon />}
                                                                href={shiftHref}
                                                                component="a"
                                                                onClick={(event) => event.stopPropagation()}
                                                            >
                                                                シフト確認
                                                            </Button>
                                                        )}
                                                    </Stack>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, p: 1.5 }}>
                            {shiftVarianceRows.length === 0 ? (
                                <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>データがありません</Box>
                            ) : shiftVarianceRows.map(row => {
                                const startStr = new Date(row.startAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                const endStr = row.endAt ? new Date(row.endAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
                                const recordHref = getRecordHref(row);
                                const shiftHref = getShiftHref(row);
                                return (
                                    <Box
                                        key={row.id}
                                        onClick={() => {
                                            if (recordHref) router.push(recordHref);
                                        }}
                                        sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', cursor: recordHref ? 'pointer' : 'default' }}
                                    >
                                        <Stack spacing={1.25}>
                                            <Box>
                                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                    <Typography variant="caption" color="text.secondary">{endStr ? `${startStr} - ${endStr}` : startStr}</Typography>
                                                    {row.isUnplanned && <Chip label="予定なし" size="small" color="default" variant="outlined" />}
                                                    {row.isMonthClipped && <Chip label="月内分" size="small" variant="outlined" />}
                                                </Stack>
                                                <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.clientName}</Typography>
                                                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{row.staffNames}</Typography>
                                            </Box>
                                            <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1}>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">予定</Typography>
                                                    <Typography fontWeight="bold">{row.plannedH != null ? `${row.plannedH.toFixed(1)}h` : '—'}</Typography>
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">実績</Typography>
                                                    <Typography fontWeight="bold">{row.actualH != null ? `${row.actualH.toFixed(1)}h` : '—'}</Typography>
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">差異</Typography>
                                                    <Typography color={row.diffH != null && row.diffH < -0.1 ? 'error.main' : 'text.primary'} fontWeight={row.diffH != null && row.diffH < -0.1 ? 'bold' : 'normal'}>
                                                        {row.diffH != null ? `${row.diffH >= 0 ? '+' : ''}${row.diffH.toFixed(1)}h` : '—'}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                                {recordHref ? (
                                                    <Button
                                                        size="small"
                                                        variant={row.reportId ? 'outlined' : 'contained'}
                                                        startIcon={<EditNoteIcon />}
                                                        href={recordHref}
                                                        component="a"
                                                        onClick={(event) => event.stopPropagation()}
                                                    >
                                                        {row.reportId ? '実績確認' : '実績作成'}
                                                    </Button>
                                                ) : (
                                                    <Chip label="実績なし" size="small" color="warning" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                                                )}
                                                {shiftHref && (
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        color="inherit"
                                                        startIcon={<EventNoteIcon />}
                                                        href={shiftHref}
                                                        component="a"
                                                        onClick={(event) => event.stopPropagation()}
                                                    >
                                                        シフト確認
                                                    </Button>
                                                )}
                                            </Stack>
                                        </Stack>
                                    </Box>
                                );
                            })}
                        </Stack>
                        </>
                        )
                    )}
                </Paper>
            </Box>
        </Box>
    );
}
