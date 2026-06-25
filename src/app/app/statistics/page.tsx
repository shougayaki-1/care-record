'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Tabs, Tab, Stack, TextField, Button,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@/components/ui/mui';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';

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

function getOverlappingHours(start: Date, end: Date, monthStart: Date, monthEnd: Date): number {
    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd = end < monthEnd ? end : monthEnd;
    if (overlapStart >= overlapEnd) return 0;
    return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
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
        if (!targetMonth) return { rows: [], premiumMinsPerStaff: {} };

        const [yearStr, monthStr] = targetMonth.split('-');
        const monthStart = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1, 0, 0, 0);
        const monthEnd = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0, 23, 59, 59, 999);

        const statsMap: Record<string, AggregatedRow> = {};
        // Per-staff actual report slots for premium calculation (staff tab only)
        const staffReportsMap: Record<string, Array<{ start_at: string; end_at: string }>> = {};

        const addHours = (name: string, type: 'planned' | 'actual', hours: number) => {
            if (!name) return;
            if (!statsMap[name]) statsMap[name] = { name, plannedHours: 0, actualHours: 0 };
            if (type === 'planned') statsMap[name].plannedHours += hours;
            else statsMap[name].actualHours += hours;
        };
        const addStaffReport = (name: string, start_at: string, end_at: string) => {
            if (!name) return;
            (staffReportsMap[name] ??= []).push({ start_at, end_at });
        };

        // ① 単発シフトの集計 (予定時間)
        rawShifts.forEach(shift => {
            const shiftStart = new Date(shift.start_at);
            const shiftEnd = new Date(shift.end_at);
            const hours = getOverlappingHours(shiftStart, shiftEnd, monthStart, monthEnd);
                
            if (hours > 0) {
                if (tabIndex === 1 && shift.clients?.name) {
                    const clientName = Array.isArray(shift.clients) ? shift.clients[0]?.name : shift.clients.name;
                    addHours(clientName, 'planned', hours);
                }
                if (tabIndex === 0) {
                    if (shift.shift_staffs && shift.shift_staffs.length > 0) {
                        shift.shift_staffs.forEach(staff => {
                            const sName = Array.isArray(staff.staffs) ? staff.staffs[0]?.name : staff.staffs?.name;
                            if (sName) addHours(sName, 'planned', hours);
                            else addHours('未設定(スタッフ名なし)', 'planned', hours);
                        });
                    } else {
                        addHours('未設定(シフト担当者なし)', 'planned', hours);
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

                    if (Array.isArray(actualHelpers) && actualHelpers.length > 0) {
                        actualHelpers.forEach(helperName => {
                            if (helperName) {
                                addHours(String(helperName), 'actual', actualHours);
                                addStaffReport(String(helperName), report.start_at, report.end_at);
                            }
                        });
                    } else if (report.helper?.name) {
                        // 古いデータなどで _helpers がない場合のフォールバック
                        const fallbackName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper.name;
                        if (fallbackName) {
                            addHours(fallbackName, 'actual', actualHours);
                            addStaffReport(fallbackName, report.start_at, report.end_at);
                        }
                    } else {
                        addHours('未設定(担当者不明)', 'actual', actualHours);
                    }
                }
            }
        });

        const rows = Object.values(statsMap).sort((a, b) => a.name.localeCompare(b.name));

        // Compute premium minutes per staff (staff tab only)
        const premiumMinsPerStaff: Record<string, Record<string, number>> = {};
        if (tabIndex === 0) {
            for (const staffName of Object.keys(staffReportsMap)) {
                premiumMinsPerStaff[staffName] = aggregatePremiumMinutes(premiumTypes, staffReportsMap[staffName]);
            }
        }

        return { rows, premiumMinsPerStaff };
    }, [rawShifts, rawReports, targetMonth, tabIndex, premiumTypes]);

    const handleExportCSV = () => {
        const { rows: aggRows, premiumMinsPerStaff } = aggregatedData;
        const premiumHeaders = tabIndex === 0 ? premiumTypes.map(t => `${t.name}(h)`) : [];
        const header = ['氏名', '予定時間(h)', '実績時間(h)', '差異(h)', ...premiumHeaders];
        const csvRows = aggRows.map(row => {
            const premiumCells = tabIndex === 0
                ? premiumTypes.map(t => ((premiumMinsPerStaff[row.name]?.[t.id] ?? 0) / 60).toFixed(2))
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
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <AssessmentIcon color="action" />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">統計・予実管理</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: 'background.default' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={3} spacing={2}>
                    <TextField type="month" label="対象月" size="small" slotProps={{ inputLabel: { shrink: true } }} value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} sx={{ bgcolor: 'background.paper', minWidth: 200 }} />
                    <Button variant="outlined" color="primary" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={loading || aggregatedData.rows.length === 0} sx={{ bgcolor: 'background.paper' }}>CSVダウンロード</Button>
                </Stack>

                <Paper sx={{ p: 0, minHeight: 400, borderRadius: 3, overflow: 'hidden', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                    {loading ? <Box display="flex" justifyContent="center" alignItems="center" height={300}><CircularProgress /></Box> : (
                        <TableContainer>
                            <Table>
                                <TableHead sx={{ bgcolor: 'background.tint' }}>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{tabIndex === 0 ? 'スタッフ名' : '利用者名'}</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異 (h)</TableCell>
                                        {tabIndex === 0 && premiumTypes.map(t => (
                                            <TableCell key={t.id} align="right" sx={{ fontWeight: 'bold' }}>{t.name}(h)</TableCell>
                                        ))}
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {aggregatedData.rows.length === 0 ? <TableRow><TableCell colSpan={4 + (tabIndex === 0 ? premiumTypes.length : 0)} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow> : (
                                        aggregatedData.rows.map((row, i) => {
                                            const diff = row.actualHours - row.plannedHours;
                                            const isAlert = diff < -2 || diff > 2; // ±2時間以上で赤字
                                            return (
                                                <TableRow key={i} hover>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>{row.name}</TableCell>
                                                    <TableCell align="right">{row.plannedHours.toFixed(2)}</TableCell>
                                                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>{row.actualHours.toFixed(2)}</TableCell>
                                                    <TableCell align="right" sx={{ color: isAlert ? 'error.main' : 'inherit', fontWeight: isAlert ? 'bold' : 'normal' }}>{diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</TableCell>
                                                    {tabIndex === 0 && premiumTypes.map(t => (
                                                        <TableCell key={t.id} align="right">
                                                            {((aggregatedData.premiumMinsPerStaff[row.name]?.[t.id] ?? 0) / 60).toFixed(1)}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </Paper>
            </Box>
        </Box>
    );
}
