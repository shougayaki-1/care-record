'use client';

import React, { useDeferredValue, useState, useMemo, useCallback, useTransition } from 'react';
import {
    Box, Typography, Paper, CircularProgress, LinearProgress, Tabs, Tab, Stack, Button,
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
import { MonthField, TablePageSkeleton } from '@/components/ui';
import { type LaborPremiumType } from '@/utils/laborPremium';
import { type InternalWorkRecord } from '@/app/actions/internalWork';
import { getStatisticsData } from '@/app/actions/statistics';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';
import {
    aggregateByTab,
    buildShiftVarianceRows,
    buildStatisticsCsv,
    type PremiumComparison,
    type ReportValuesData,
    type StaffDetailItem,
    type ShiftVarianceRow,
} from '@/utils/statisticsAggregation';
import { useFetchData } from '@/hooks/useFetchData';
import { StaffReportTable } from '@/components/statistics/StaffReportTable';
import { ShiftVarianceTable } from '@/components/statistics/ShiftVarianceTable';

type ShiftStaffData = { staff_id: string; staffs: { name: string } | null; };
type ShiftData = { 
    id: string; start_at: string; end_at: string; status: string; client_id: string; 
    clients: { name: string } | null; shift_staffs: ShiftStaffData[]; 
};

type ReportData = { 
    id: string; start_at: string; end_at: string; status: string; client_id: string; segment_id?: string | null; actual_service_type_id?: string | null;
    clients: { name: string } | null; 
    helper?: { name: string } | null;
    report_values: { data: ReportValuesData }[] | null; 
    actual_service_type?: { name: string } | null;
    report_actual_staffs?: Array<{ staff?: { name: string } | null }>;
    report_shifts?: { shift_id: string }[] | null;
};

type ShiftWithLinks = {
    id: string; start_at: string; end_at: string; client_id: string;
    clients: { name: string } | null;
    shift_staffs: Array<{ staffs: { name: string } | null }>;
    report_shifts: Array<{ is_primary: boolean; reports: ReportForStats | null }>;
    shift_segments?: ShiftSegmentForStats[];
};

type ReportForStats = {
    id: string;
    start_at: string;
    end_at: string;
    status: string;
    segment_id?: string | null;
    actual_service_type_id?: string | null;
    deleted_at?: string | null;
    report_values?: { data: ReportValuesData }[] | null;
    actual_service_type?: { name: string } | null;
    report_actual_staffs?: Array<{ staff?: { name: string } | null }>;
};

type ShiftSegmentForStats = {
    id: string;
    start_at: string;
    end_at: string;
    sort_order: number;
    service_type?: { name: string } | null;
    shift_segment_staffs?: Array<{ staff_id: string; staff?: { name: string } | null }>;
    reports?: ReportForStats[];
};

type StatisticsSourceData = {
    rawShifts: ShiftData[];
    rawReports: ReportData[];
    premiumTypes: LaborPremiumType[];
    rawShiftsWithLinks: ShiftWithLinks[];
    internalWorkRecords: InternalWorkRecord[];
};
const initialStatisticsSourceData: StatisticsSourceData = {
    rawShifts: [],
    rawReports: [],
    premiumTypes: [],
    rawShiftsWithLinks: [],
    internalWorkRecords: [],
};

function formatDetailDateTime(value: string): string {
    return new Date(value).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function StatisticsPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();

    const [targetMonth, setTargetMonth] = useState<string>(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [tabIndex, setTabIndex] = useState(0); 
    const [isPending, startTransition] = useTransition();

    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

    const fetchStatisticsData = useCallback(async (): Promise<StatisticsSourceData> => {
        if (!currentOrg || !targetMonth) return initialStatisticsSourceData;
            const [yearStr, monthStr] = targetMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10) - 1;

            const monthStart = new Date(year, month, 1, 0, 0, 0);
            const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

            const shiftStartRange = new Date(monthStart.getTime() - (24 * 60 * 60 * 1000)).toISOString();
            const shiftEndRange = new Date(monthEnd.getTime() + (24 * 60 * 60 * 1000)).toISOString();

            const data = await getStatisticsData(currentOrg.id, shiftStartRange, shiftEndRange);
            return {
                rawShifts: data.shifts as ShiftData[],
                rawReports: data.reports as ReportData[],
                internalWorkRecords: data.internalWorkRecords as InternalWorkRecord[],
                premiumTypes: data.premiumTypes as LaborPremiumType[],
                rawShiftsWithLinks: data.shiftsWithLinks as ShiftWithLinks[],
            };
    }, [currentOrg, targetMonth]);

    const {
        data: statisticsSourceData,
        loading,
    } = useFetchData(fetchStatisticsData, initialStatisticsSourceData, !wsLoading && Boolean(currentOrg), (message) => {
        showToast(`データの取得に失敗しました: ${message}`, 'error');
    });
    const { rawShifts, rawReports, premiumTypes, rawShiftsWithLinks, internalWorkRecords } = statisticsSourceData;

    const aggregatedDataByTab = useMemo(() => aggregateByTab({
        rawShifts,
        rawReports,
        internalWorkRecords,
        targetMonth,
        premiumTypes,
    }), [rawShifts, rawReports, internalWorkRecords, targetMonth, premiumTypes]);

    const aggregatedData = tabIndex === 0 ? aggregatedDataByTab.byStaff : aggregatedDataByTab.byClient;
    const deferredAggregatedData = useDeferredValue(aggregatedData);
    const isAggregatedStale = aggregatedData !== deferredAggregatedData;
    const visibleAggregatedData = deferredAggregatedData;

    const shiftVarianceRows = useMemo(() => buildShiftVarianceRows({
        rawShiftsWithLinks,
        rawReports,
        targetMonth,
    }), [rawShiftsWithLinks, rawReports, targetMonth]);

    const unregisteredCount = useMemo(
        () => shiftVarianceRows.filter(row => !row.reportId).length,
        [shiftVarianceRows],
    );

    const aggregatedTotals = useMemo(() => {
        return visibleAggregatedData.rows.reduce(
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
    }, [visibleAggregatedData.rows]);

    const premiumTotals = useMemo(() => {
        if (tabIndex !== 0) return {} as PremiumComparison;
        return premiumTypes.reduce((totals, type) => {
            const total = visibleAggregatedData.rows.reduce((sum, row) => {
                const premium = visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[type.id] ?? { planned: 0, actual: 0, diff: 0 };
                return {
                    planned: sum.planned + premium.planned,
                    actual: sum.actual + premium.actual,
                    diff: sum.diff + premium.diff,
                };
            }, { planned: 0, actual: 0, diff: 0 });
            totals[type.id] = total;
            return totals;
        }, {} as PremiumComparison);
    }, [visibleAggregatedData.premiumComparisonPerStaff, visibleAggregatedData.rows, premiumTypes, tabIndex]);

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
                ? `/app/record/${row.clientId}?shiftId=${row.shiftId}${row.segmentId ? `&segmentId=${row.segmentId}` : ''}`
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

    const handleTabChange = useCallback((_: React.SyntheticEvent, value: number) => {
        startTransition(() => setTabIndex(value));
    }, [startTransition]);

    const handleTargetMonthChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        startTransition(() => setTargetMonth(value));
    }, [startTransition]);

    const handleExportCSV = () => {
        const { rows: aggRows, premiumComparisonPerStaff } = aggregatedData;
        const csvContent = buildStatisticsCsv(aggRows, premiumComparisonPerStaff, premiumTypes, tabIndex);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `稼働集計_${targetMonth}_${tabIndex === 0 ? 'スタッフ別' : '利用者別'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (wsLoading || !currentOrg) return <TablePageSkeleton />;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 2, sm: 3 }, pt: 2, flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <AssessmentIcon color="action" />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">統計・予実管理</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                    <Tab label="シフト差異" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
                {(isPending || isAggregatedStale) && <LinearProgress sx={{ mb: 2 }} />}
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} spacing={2}>
                    <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
                        <MonthField label="対象月" size="small" value={targetMonth} onChange={handleTargetMonthChange} sx={{ minWidth: { xs: 0, sm: 200 } }} />
                        {!loading && (
                            <Chip
                                size="small"
                                color={unregisteredCount > 0 ? 'warning' : 'default'}
                                variant={unregisteredCount > 0 ? 'filled' : 'outlined'}
                                label={`未登録の実績 ${unregisteredCount}件`}
                            />
                        )}
                    </Stack>
                    {tabIndex < 2 && <Button variant="outlined" color="primary" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={loading || visibleAggregatedData.rows.length === 0} sx={{ bgcolor: 'background.paper' }}>CSVダウンロード</Button>}
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
                        <StaffReportTable>
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
                                    {visibleAggregatedData.rows.length === 0 ? <TableRow><TableCell colSpan={6 + (tabIndex === 0 ? premiumTypes.length : 0)} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow> : (
                                        visibleAggregatedData.rows.map((row) => {
                                            const diff = row.actualHours - row.plannedHours;
                                            const premiumDiff = premiumTypes.some(t => Math.abs(visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id]?.diff ?? 0) >= 1);
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
                                                            const premium = visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
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
                                                                        {(visibleAggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => {
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
                            {visibleAggregatedData.rows.length === 0 ? (
                                <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>データがありません</Box>
                            ) : visibleAggregatedData.rows.map((row, i) => {
                                const diff = row.actualHours - row.plannedHours;
                                const premiumDiff = premiumTypes.some(t => Math.abs(visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id]?.diff ?? 0) >= 1);
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
                                                    const premium = visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
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
                                                {(visibleAggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => {
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
                        </StaffReportTable>
                        ) : (
                        <ShiftVarianceTable>
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
                                                        {row.isUnplanned && <Chip label={row.isLegacyReport ? '大枠記録' : '予定なし'} size="small" color="default" variant="outlined" />}
                                                        {row.isMonthClipped && <Chip label="月内分" size="small" variant="outlined" />}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>{row.clientName}</TableCell>
                                                <TableCell>
                                                    <Stack spacing={0.5}>
                                                        <Typography variant="body2">{row.staffNames}</Typography>
                                                        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                                                            {row.hasStaffMismatch && <Chip label={`担当不一致 実績: ${row.actualStaffNames}`} size="small" color="warning" variant="outlined" />}
                                                            {row.hasServiceTypeMismatch && <Chip label={`サービス不一致 実績: ${row.actualServiceTypeName}`} size="small" color="warning" variant="outlined" />}
                                                            {row.isLegacyReport && <Chip label="大枠記録" size="small" color="default" variant="outlined" />}
                                                        </Stack>
                                                    </Stack>
                                                </TableCell>
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
                                                        {row.isUnplanned && <Chip label={row.isLegacyReport ? '大枠記録' : '予定なし'} size="small" color="default" variant="outlined" />}
                                                        {row.isMonthClipped && <Chip label="月内分" size="small" variant="outlined" />}
                                                        {row.hasStaffMismatch && <Chip label="担当不一致" size="small" color="warning" variant="outlined" />}
                                                        {row.hasServiceTypeMismatch && <Chip label="サービス不一致" size="small" color="warning" variant="outlined" />}
                                                    </Stack>
                                                    <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.clientName}</Typography>
                                                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{row.staffNames}</Typography>
                                                    {row.hasStaffMismatch && (
                                                        <Typography variant="caption" color="warning.main" sx={{ overflowWrap: 'anywhere' }}>
                                                            実績担当: {row.actualStaffNames}
                                                        </Typography>
                                                    )}
                                                    {row.hasServiceTypeMismatch && (
                                                        <Typography variant="caption" color="warning.main" sx={{ overflowWrap: 'anywhere' }}>
                                                            実績サービス: {row.actualServiceTypeName}
                                                        </Typography>
                                                    )}
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
                        </ShiftVarianceTable>
                        )
                    )}
                </Paper>
            </Box>
        </Box>
    );
}
