'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Tabs, Tab, Stack, TextField, Button,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { rrulestr } from 'rrule';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';

type ShiftStaffData = { user_id: string | null; ghost_staff_id: string | null; profiles: { name: string } | null; ghost_staffs: { name: string } | null; };
type ShiftData = { id: string; start_at: string; end_at: string; is_recurring: boolean; rrule: string | null; status: string; client_id: string; clients: { name: string } | null; shift_staffs: ShiftStaffData[]; };
type ReportData = { id: string; start_at: string; end_at: string; status: string; client_id: string; clients: { name: string } | null; report_values: { data: { _helpers?: string[] } }[] | null; };
type AggregatedRow = { name: string; plannedHours: number; actualHours: number; };

function getOverlappingHours(start: Date, end: Date, monthStart: Date, monthEnd: Date): number {
    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd = end < monthEnd ? end : monthEnd;
    if (overlapStart >= overlapEnd) return 0;
    return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
}

// ★追加：UTCズレを防ぐローカルタイムの DTSTART 生成関数
const getLocalDTSTART = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
};

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

    const fetchStatisticsData = useCallback(async () => {
        if (!currentOrg || !targetMonth) return;
        setLoading(true);

        try {
            const [yearStr, monthStr] = targetMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10) - 1;

            const monthStart = new Date(year, month, 1, 0, 0, 0);
            const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

            const { data: shiftsData, error: shiftsError } = await supabase
                .from('shifts')
                .select(`
                    id, start_at, end_at, is_recurring, rrule, status, client_id,
                    clients (name),
                    shift_staffs (user_id, ghost_staff_id, profiles(name), ghost_staffs(name))
                `)
                .eq('organization_id', currentOrg.id)
                .neq('status', 'cancelled');

            if (shiftsError) throw shiftsError;

            const { data: reportsData, error: reportsError } = await supabase
                .from('reports')
                .select(`
                    id, start_at, end_at, status, client_id,
                    clients (name),
                    report_values (data)
                `)
                .eq('clients.organization_id', currentOrg.id)
                .in('status', ['pending', 'approved']) 
                .gte('end_at', monthStart.toISOString())
                .lte('start_at', monthEnd.toISOString());

            if (reportsError) throw reportsError;

            setRawShifts((shiftsData as unknown as ShiftData[]) || []);
            setRawReports((reportsData as unknown as ReportData[]) || []);
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
        if (!targetMonth) return [];

        const [yearStr, monthStr] = targetMonth.split('-');
        const monthStart = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1, 0, 0, 0);
        const monthEnd = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0, 23, 59, 59, 999);

        const statsMap: Record<string, AggregatedRow> = {};

        const addHours = (name: string, type: 'planned' | 'actual', hours: number) => {
            if (!name) return;
            if (!statsMap[name]) {
                statsMap[name] = { name, plannedHours: 0, actualHours: 0 };
            }
            if (type === 'planned') statsMap[name].plannedHours += hours;
            else statsMap[name].actualHours += hours;
        };

        rawShifts.forEach(shift => {
            const shiftStart = new Date(shift.start_at);
            const shiftEnd = new Date(shift.end_at);
            const durationMs = shiftEnd.getTime() - shiftStart.getTime();

            let occurrences: Date[] = [];
            if (shift.is_recurring && shift.rrule) {
                try {
                    // ★修正：UTCズレ防止のためローカル時間でDTSTARTを生成
                    const dtStartStr = getLocalDTSTART(shiftStart);
                    const ruleStr = `DTSTART:${dtStartStr}\nRRULE:${shift.rrule}`;
                    const rule = rrulestr(ruleStr);
                    occurrences = rule.between(monthStart, monthEnd, true);
                } catch (e) {
                    console.warn('RRULE Parse error', e);
                }
            } else {
                occurrences = [shiftStart];
            }

            occurrences.forEach(occStart => {
                const occEnd = new Date(occStart.getTime() + durationMs);
                const hours = getOverlappingHours(occStart, occEnd, monthStart, monthEnd);
                
                if (hours > 0) {
                    if (tabIndex === 1 && shift.clients?.name) {
                        addHours(shift.clients.name, 'planned', hours);
                    }
                    if (tabIndex === 0) {
                        shift.shift_staffs.forEach(staff => {
                            const sName = staff.profiles?.name || staff.ghost_staffs?.name;
                            if (sName) addHours(sName, 'planned', hours);
                        });
                    }
                }
            });
        });

        rawReports.forEach(report => {
            const rStart = new Date(report.start_at);
            const rEnd = new Date(report.end_at);
            const hours = getOverlappingHours(rStart, rEnd, monthStart, monthEnd);

            if (hours > 0) {
                if (tabIndex === 1 && report.clients?.name) {
                    addHours(report.clients.name, 'actual', hours);
                }
                if (tabIndex === 0) {
                    const reportValuesData = report.report_values && report.report_values.length > 0 
                        ? report.report_values[0].data 
                        : null;
                    
                    const actualHelpers = reportValuesData?._helpers || [];
                    
                    actualHelpers.forEach(helperName => {
                        if (helperName) addHours(helperName, 'actual', hours);
                    });
                }
            }
        });

        return Object.values(statsMap).sort((a, b) => a.name.localeCompare(b.name));
    }, [rawShifts, rawReports, targetMonth, tabIndex]);

    const handleExportCSV = () => {
        const header = ['氏名', '予定時間(h)', '実績時間(h)', '差異(h)'];
        const rows = aggregatedData.map(row => [
            `"${row.name}"`,
            row.plannedHours.toFixed(2),
            row.actualHours.toFixed(2),
            (row.actualHours - row.plannedHours).toFixed(2)
        ]);

        const csvContent = '\uFEFF' + [header.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        const typeStr = tabIndex === 0 ? 'スタッフ別' : '利用者別';
        link.setAttribute('download', `稼働集計_${targetMonth}_${typeStr}.csv`);
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

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={3} spacing={2}>
                    <TextField
                        type="month"
                        label="対象月"
                        size="small"
                        InputLabelProps={{ shrink: true }}
                        value={targetMonth}
                        onChange={(e) => setTargetMonth(e.target.value)}
                        sx={{ bgcolor: 'white', minWidth: 200 }}
                    />
                    <Button 
                        variant="outlined" 
                        color="primary" 
                        startIcon={<DownloadIcon />} 
                        onClick={handleExportCSV}
                        disabled={loading || aggregatedData.length === 0}
                        sx={{ bgcolor: 'white' }}
                    >
                        CSVダウンロード
                    </Button>
                </Stack>

                <Paper sx={{ p: 0, minHeight: 400, borderRadius: 3, overflow: 'hidden', boxShadow: 'none', border: '1px solid #E3E5E8' }}>
                    {loading ? (
                        <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <TableContainer>
                            <Table>
                                <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 'bold' }}>氏名</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績時間 (h)</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異 (h)</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {aggregatedData.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} align="center" sx={{ py: 5, color: '#666' }}>
                                                データがありません
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        aggregatedData.map((row, i) => {
                                            const diff = row.actualHours - row.plannedHours;
                                            const isAlert = diff < -2 || diff > 2;
                                            return (
                                                <TableRow key={i} hover>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>{row.name}</TableCell>
                                                    <TableCell align="right">{row.plannedHours.toFixed(2)}</TableCell>
                                                    <TableCell align="right" sx={{ fontWeight: 'bold', color: '#2255CC' }}>
                                                        {row.actualHours.toFixed(2)}
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ color: isAlert ? '#d32f2f' : 'inherit', fontWeight: isAlert ? 'bold' : 'normal' }}>
                                                        {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                                                    </TableCell>
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