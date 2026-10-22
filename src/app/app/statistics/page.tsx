'use client';

import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';

import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import React, { useDeferredValue, useState, useMemo, useCallback, useTransition } from 'react';
import { Alert, Box, Typography, Paper, CircularProgress, LinearProgress, Tabs, Tab, Stack, Button, Chip } from '@/components/ui/mui';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { useRouter } from 'next/navigation';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { MonthField, TablePageSkeleton } from '@/components/ui';
import { getStatisticsData } from '@/app/actions/statistics';
import { initialStatisticsSourceData, toStatisticsSource, type StatisticsSourceData } from '@/utils/statisticsSource';
import {
    aggregateByTab,
    buildShiftVarianceRows,
    buildStatisticsCsv,
    type PremiumComparison,
    type StaffDetailItem,
    type ShiftVarianceRow,
} from '@/utils/statisticsAggregation';
import { useFetchData } from '@/hooks/useFetchData';
import { StaffReportView } from '@/components/statistics/StaffReportView';
import { ShiftVarianceView } from '@/components/statistics/ShiftVarianceView';



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

            const data = await readActionResult(getStatisticsData(currentOrg.id, shiftStartRange, shiftEndRange));
            return toStatisticsSource(data);
    }, [currentOrg, targetMonth]);

    const {
        data: statisticsSourceData,
        loading, error: loadError, refetch: retryStatistics,
    } = useFetchData(fetchStatisticsData, initialStatisticsSourceData, !wsLoading && Boolean(currentOrg), (message) => {
        showToast(`データの取得に失敗しました: ${message}`, 'error');
    }, `${currentOrg?.id ?? ''}:${targetMonth}`);
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

    if (loadError != null) return <Box p={3}><Alert severity="error" action={needsActionRecovery(loadError) ? <RecoveryLogoutButton /> : <Button onClick={() => void retryStatistics()}>再試行</Button>}>{getActionErrorMessage(loadError)}</Alert></Box>;
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
                        <StaffReportView
                            tabIndex={tabIndex}
                            premiumTypes={premiumTypes}
                            visibleAggregatedData={visibleAggregatedData}
                            expandedRows={expandedRows}
                            setExpandedRows={setExpandedRows}
                            getDetailRecordHref={getDetailRecordHref}
                            getDetailShiftHref={getDetailShiftHref}
                        />
                        ) : (
                        <ShiftVarianceView
                            shiftVarianceRows={shiftVarianceRows}
                            shiftVarianceTotals={shiftVarianceTotals}
                            getRecordHref={getRecordHref}
                            getShiftHref={getShiftHref}
                            onNavigate={router.push}
                        />
                        )
                    )}
                </Paper>
            </Box>
        </Box>
    );
}
