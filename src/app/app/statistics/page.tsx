'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Tabs, Tab, Stack, TextField, Button,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, Collapse, Divider
} from '@/components/ui/mui';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import { aggregatePremiumMinutes, type LaborPremiumType } from '@/utils/laborPremium';

type ShiftStaffData = { staff_id: string; staffs: { name: string } | null; };
type ShiftData = { 
    id: string; start_at: string; end_at: string; status: string; client_id: string; 
    clients: { name: string } | null; shift_staffs: ShiftStaffData[]; 
};

type ReportData = { 
    id: string; start_at: string; end_at: string; status: string; client_id: string; 
    clients: { name: string } | null; 
    helper?: { name: string } | null;
    report_values: { data: { _helpers?: string[]; service_time?: string|number; travel_time?: string|number; } }[] | null; 
};

type AggregatedRow = { name: string; plannedHours: number; actualHours: number; };
type PremiumComparison = Record<string, { planned: number; actual: number; diff: number }>;
type StaffDetailItem = {
    id: string;
    kind: 'planned' | 'actual';
    clientName: string;
    startAt: string;
    endAt: string;
    hours: number;
    status?: string;
};

type ShiftWithLinks = {
    id: string; start_at: string; end_at: string; client_id: string;
    clients: { name: string } | null;
    shift_staffs: Array<{ staffs: { name: string } | null }>;
    report_shifts: Array<{ is_primary: boolean; reports: { id: string; start_at: string; end_at: string; status: string } | null }>;
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

function formatDetailDateTime(value: string): string {
    return new Date(value).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function StatisticsPage() {
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

            // 予定（シフト）の取得
            const { data: shiftsData, error: shiftsError } = await supabase
                .from('shifts')
                .select(`
                    id, start_at, end_at, status, client_id,
                    clients (name),
                    shift_staffs (staff_id, staffs(name))
                `)
                .eq('organization_id', currentOrg.id)
                .neq('status', 'cancelled')
                .gte('end_at', shiftStartRange)
                .lte('start_at', shiftEndRange);

            if (shiftsError) throw shiftsError;

            // 実績（記録）の取得
            const { data: reportsData, error: reportsError } = await supabase
                .from('reports')
                .select(`
                    id, start_at, end_at, status, client_id,
                    clients (name),
                    helper:profiles!reports_helper_id_fkey (name),
                    report_values (data)
                `)
                .is('deleted_at', null)
                .eq('clients.organization_id', currentOrg.id)
                .in('status', ['pending', 'approved']) 
                .gte('end_at', shiftStartRange)
                .lte('start_at', shiftEndRange);

            if (reportsError) throw reportsError;

            // シフト差異タブ用: シフトと紐付き記録を一緒に取得
            const { data: shiftsWithLinksData } = await supabase
                .from('shifts')
                .select(`
                    id, start_at, end_at, client_id,
                    clients (name),
                    shift_staffs (staffs(name)),
                    report_shifts (is_primary, reports(id, start_at, end_at, status))
                `)
                .eq('organization_id', currentOrg.id)
                .neq('status', 'cancelled')
                .is('deleted_at', null)
                .gte('end_at', shiftStartRange)
                .lte('start_at', shiftEndRange);

            setRawShifts((shiftsData as unknown as ShiftData[]) || []);
            setRawReports((reportsData as unknown as ReportData[]) || []);

            // 割り増し種別を取得
            const { data: rawPremiumTypes } = await supabase
                .from('labor_premium_types')
                .select('*')
                .eq('organization_id', currentOrg.id)
                .eq('is_enabled', true)
                .order('display_order');
            setPremiumTypes((rawPremiumTypes ?? []) as LaborPremiumType[]);
            setRawShiftsWithLinks((shiftsWithLinksData as unknown as ShiftWithLinks[]) || []);
        } catch (error) {
            console.error(error);
            showToast('データの取得に失敗しました', 'error');
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

        const addHours = (name: string, type: 'planned' | 'actual', hours: number) => {
            if (!name) return;
            if (!statsMap[name]) statsMap[name] = { name, plannedHours: 0, actualHours: 0 };
            if (type === 'planned') statsMap[name].plannedHours += hours;
            else statsMap[name].actualHours += hours;
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
                                startAt: shift.start_at,
                                endAt: shift.end_at,
                                hours,
                                status: shift.status,
                            });
                        });
                    } else {
                        addHours('未設定(シフト担当者なし)', 'planned', hours);
                        if (clipped) addStaffSlot(staffShiftsMap, '未設定(シフト担当者なし)', clipped.start_at, clipped.end_at);
                        addDetailItem('未設定(シフト担当者なし)', {
                            id: `planned-${shift.id}-unassigned`,
                            kind: 'planned',
                            clientName: clientName ?? '—',
                            startAt: shift.start_at,
                            endAt: shift.end_at,
                            hours,
                            status: shift.status,
                        });
                    }
                }
            }
        });

        // ② 実績（記録）の集計 (実績時間)
        rawReports.forEach(report => {
            let actualHours = 0;
            const dataObj = (report.report_values && report.report_values.length > 0) ? report.report_values[0].data : null;
            
            // サービス時間に移動時間も含まれている前提のため、service_timeのみを実績時間とする
            if (dataObj) {
                const sTime = parseFloat(String(dataObj.service_time || 0)) || 0;
                actualHours = sTime;
            }

            // もし入力されていなければ start_at と end_at から計算 (フォールバック)
            if (actualHours <= 0) {
                const rStart = new Date(report.start_at);
                const rEnd = new Date(report.end_at);
                actualHours = getOverlappingHours(rStart, rEnd, monthStart, monthEnd);
            }

            if (actualHours > 0) {
                if (tabIndex === 1 && report.clients?.name) {
                    const clientName = Array.isArray(report.clients) ? report.clients[0]?.name : report.clients.name;
                    addHours(clientName, 'actual', actualHours);
                }
                if (tabIndex === 0) {
                    const actualHelpers = dataObj?._helpers || [];
                    const clipped = clipSlotToMonth(report.start_at, report.end_at, monthStart, monthEnd);
                    const clientName = Array.isArray(report.clients) ? report.clients[0]?.name : report.clients?.name;
                    const addActualForStaff = (helperName: string) => {
                        addHours(helperName, 'actual', actualHours);
                        if (clipped) addStaffSlot(staffReportsMap, helperName, clipped.start_at, clipped.end_at);
                        addDetailItem(helperName, {
                            id: `actual-${report.id}-${helperName}`,
                            kind: 'actual',
                            clientName: clientName ?? '—',
                            startAt: report.start_at,
                            endAt: report.end_at,
                            hours: actualHours,
                            status: report.status,
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
                        if (clipped) addStaffSlot(staffReportsMap, '未設定(担当者不明)', clipped.start_at, clipped.end_at);
                        addDetailItem('未設定(担当者不明)', {
                            id: `actual-${report.id}-unknown`,
                            kind: 'actual',
                            clientName: clientName ?? '—',
                            startAt: report.start_at,
                            endAt: report.end_at,
                            hours: actualHours,
                            status: report.status,
                        });
                    }
                }
            }
        });

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
    }, [rawShifts, rawReports, targetMonth, tabIndex, premiumTypes]);

    const handleExportCSV = () => {
        const { rows: aggRows, premiumComparisonPerStaff } = aggregatedData;
        const premiumHeaders = tabIndex === 0 ? premiumTypes.flatMap(t => [`${t.name}予定(h)`, `${t.name}実績(h)`, `${t.name}差異(h)`]) : [];
        const header = ['氏名', '予定時間(h)', '実績時間(h)', '差異(h)', ...premiumHeaders];
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
                (row.actualHours - row.plannedHours).toFixed(2),
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
                    <TextField type="month" label="対象月" size="small" slotProps={{ inputLabel: { shrink: true } }} value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} sx={{ bgcolor: 'background.paper', minWidth: { xs: 0, sm: 200 } }} />
                    {tabIndex < 2 && <Button variant="outlined" color="primary" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={loading || aggregatedData.rows.length === 0} sx={{ bgcolor: 'background.paper' }}>CSVダウンロード</Button>}
                </Stack>

                <Paper sx={{ p: 0, minHeight: 400, borderRadius: 3, overflow: 'hidden', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                    {loading ? <Box display="flex" justifyContent="center" alignItems="center" height={300}><CircularProgress /></Box> : (
                        tabIndex < 2 ? (
                        <>
                        <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
                            <Table>
                                <TableHead sx={{ bgcolor: 'background.tint' }}>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{tabIndex === 0 ? 'スタッフ名' : '利用者名'}</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異 (h)</TableCell>
                                        {tabIndex === 0 && premiumTypes.map(t => (
                                            <TableCell key={t.id} align="right" sx={{ fontWeight: 'bold' }}>{t.name}<br />予定/実績/差異(h)</TableCell>
                                        ))}
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {aggregatedData.rows.length === 0 ? <TableRow><TableCell colSpan={4 + (tabIndex === 0 ? premiumTypes.length : 0)} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow> : (
                                        aggregatedData.rows.map((row, i) => {
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
                                                        <TableCell align="right" sx={{ color: isAlert ? 'error.main' : 'inherit', fontWeight: isAlert ? 'bold' : 'normal' }}>{diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</TableCell>
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
                                                        <TableCell colSpan={4 + (tabIndex === 0 ? premiumTypes.length : 0)} sx={{ p: 0, borderBottom: isExpanded ? undefined : 0 }}>
                                                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                                                <Box sx={{ px: 3, py: 2, bgcolor: 'background.tint' }}>
                                                                    <Typography variant="subtitle2" fontWeight="bold" mb={1}>差異対象シフト・実績</Typography>
                                                                    <Stack spacing={1}>
                                                                        {(aggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => (
                                                                            <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: '90px 1fr 110px', gap: 1, alignItems: 'center' }}>
                                                                                <Chip size="small" label={item.kind === 'planned' ? '予定' : '実績'} color={item.kind === 'planned' ? 'default' : 'primary'} variant={item.kind === 'planned' ? 'outlined' : 'filled'} />
                                                                                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                                                                    {item.clientName} {formatDetailDateTime(item.startAt)} - {formatDetailDateTime(item.endAt)}
                                                                                </Typography>
                                                                                <Typography variant="body2" align="right">{item.hours.toFixed(2)}h</Typography>
                                                                            </Box>
                                                                        ))}
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
                                                {(aggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => (
                                                    <Box key={item.id}>
                                                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                                            <Chip size="small" label={item.kind === 'planned' ? '予定' : '実績'} color={item.kind === 'planned' ? 'default' : 'primary'} variant={item.kind === 'planned' ? 'outlined' : 'filled'} />
                                                            <Typography variant="body2" fontWeight="bold">{item.hours.toFixed(2)}h</Typography>
                                                        </Stack>
                                                        <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                                                            {item.clientName} {formatDetailDateTime(item.startAt)} - {formatDetailDateTime(item.endAt)}
                                                        </Typography>
                                                    </Box>
                                                ))}
                                            </Stack>
                                        </Collapse>
                                    </Box>
                                );
                            })}
                        </Stack>
                        </>
                        ) : (
                        <>
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
                                        <TableCell sx={{ fontWeight: 'bold' }}>記録</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {rawShiftsWithLinks.length === 0 ? (
                                        <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow>
                                    ) : rawShiftsWithLinks.map(shift => {
                                        const plannedH = (new Date(shift.end_at).getTime() - new Date(shift.start_at).getTime()) / 3600000;
                                        const linked = shift.report_shifts ?? [];
                                        const actualMs = linked.reduce((sum, rs) => {
                                            const r = rs.reports;
                                            if (!r || !['pending', 'approved'].includes(r.status)) return sum;
                                            return sum + new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
                                        }, 0);
                                        const actualH = actualMs > 0 ? actualMs / 3600000 : null;
                                        const diffH = actualH != null ? actualH - plannedH : null;
                                        const staffNames = (shift.shift_staffs ?? []).map(s => s.staffs?.name).filter(Boolean).join('、');
                                        const startStr = new Date(shift.start_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                        const firstReport = linked.find(rs => rs.reports != null);
                                        return (
                                            <TableRow key={shift.id} hover>
                                                <TableCell>{startStr}</TableCell>
                                                <TableCell>{shift.clients?.name ?? '—'}</TableCell>
                                                <TableCell>{staffNames || '—'}</TableCell>
                                                <TableCell align="right">{plannedH.toFixed(1)}</TableCell>
                                                <TableCell align="right">{actualH != null ? actualH.toFixed(1) : '—'}</TableCell>
                                                <TableCell align="right" sx={{ color: diffH != null && diffH < -0.1 ? 'error.main' : 'inherit', fontWeight: diffH != null && diffH < -0.1 ? 'bold' : 'normal' }}>
                                                    {diffH != null ? (diffH >= 0 ? '+' : '') + diffH.toFixed(1) : '—'}
                                                </TableCell>
                                                <TableCell>
                                                    {firstReport?.reports
                                                        ? <Button size="small" href={`/app/record/${shift.client_id}?reportId=${firstReport.reports.id}`} component="a">記録を開く</Button>
                                                        : <Chip label="記録なし" size="small" color="warning" variant="outlined" />
                                                    }
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, p: 1.5 }}>
                            {rawShiftsWithLinks.length === 0 ? (
                                <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>データがありません</Box>
                            ) : rawShiftsWithLinks.map(shift => {
                                const plannedH = (new Date(shift.end_at).getTime() - new Date(shift.start_at).getTime()) / 3600000;
                                const linked = shift.report_shifts ?? [];
                                const actualMs = linked.reduce((sum, rs) => {
                                    const r = rs.reports;
                                    if (!r || !['pending', 'approved'].includes(r.status)) return sum;
                                    return sum + new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
                                }, 0);
                                const actualH = actualMs > 0 ? actualMs / 3600000 : null;
                                const diffH = actualH != null ? actualH - plannedH : null;
                                const staffNames = (shift.shift_staffs ?? []).map(s => s.staffs?.name).filter(Boolean).join('、');
                                const startStr = new Date(shift.start_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                const firstReport = linked.find(rs => rs.reports != null);
                                return (
                                    <Box key={shift.id} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
                                        <Stack spacing={1.25}>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">{startStr}</Typography>
                                                <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{shift.clients?.name ?? '—'}</Typography>
                                                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{staffNames || '—'}</Typography>
                                            </Box>
                                            <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1}>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">予定</Typography>
                                                    <Typography fontWeight="bold">{plannedH.toFixed(1)}h</Typography>
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">実績</Typography>
                                                    <Typography fontWeight="bold">{actualH != null ? `${actualH.toFixed(1)}h` : '—'}</Typography>
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">差異</Typography>
                                                    <Typography color={diffH != null && diffH < -0.1 ? 'error.main' : 'text.primary'} fontWeight={diffH != null && diffH < -0.1 ? 'bold' : 'normal'}>
                                                        {diffH != null ? `${diffH >= 0 ? '+' : ''}${diffH.toFixed(1)}h` : '—'}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            {firstReport?.reports
                                                ? <Button size="small" variant="outlined" href={`/app/record/${shift.client_id}?reportId=${firstReport.reports.id}`} component="a">記録を開く</Button>
                                                : <Chip label="記録なし" size="small" color="warning" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                                            }
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
