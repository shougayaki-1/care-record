'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Stack, Chip, TextField, Tabs, Tab, Card, CardActionArea, Divider,
    IconButton
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HistoryIcon from '@mui/icons-material/History';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';

// 新規作成した型定義およびサブコンポーネントをインポート
import { Report } from './types';
import { HistoryCalendar } from './_components/HistoryCalendar';

export default function HistoryPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const [viewMode, setViewMode] = useState(0); // 0: List, 1: Calendar
    const [reports, setReports] = useState<Report[]>([]);
    const [filterDate, setFilterDate] = useState('');
    const [currentMonth, setCurrentMonth] = useState(new Date()); // カレンダー表示用

    useEffect(() => {
        const fetchData = async () => {
            if (!currentOrg) return;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            let query = supabase.from('reports')
                .select(`id, start_at, status, client_id, clients!inner(name, organization_id)`)
                .eq('clients.organization_id', currentOrg.id)
                .neq('status', 'draft')
                .order('start_at', { ascending: false });

            if (viewMode === 0 && filterDate) {
                query = query.gte('start_at', `${filterDate}T00:00:00`).lte('start_at', `${filterDate}T23:59:59`);
            } else if (viewMode === 1) {
                const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString();
                const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59).toISOString();
                query = query.gte('start_at', start).lte('start_at', end);
            } else {
                query = query.limit(100);
            }

            const { data } = await query;
            if (data) {
                const typedData = data as unknown as Report[];
                setReports(typedData);
            }
        };

        if (!wsLoading) fetchData();
    }, [wsLoading, currentOrg, filterDate, viewMode, currentMonth]);

    const handleEdit = (report: Report) => router.push(`/app/record/${report.client_id}?reportId=${report.id}`);

    const handleMonthChange = (diff: number) => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + diff, 1));
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
                <HistoryIcon sx={{ color: 'action.active', mr: 2 }} />
                <Typography variant="h6" fontWeight="bold" color="text.primary" flexGrow={1}>履歴</Typography>
                <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} sx={{ minHeight: 0 }}>
                    <Tab icon={<ListIcon />} label="リスト" sx={{ py: 1, minHeight: 0 }} />
                    <Tab icon={<CalendarMonthIcon />} label="カレンダー" sx={{ py: 1, minHeight: 0 }} />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
                {viewMode === 0 && (
                    <>
                        <Paper sx={{ p: 2, mb: 2 }}>
                            <TextField 
                                type="date" label="日付絞り込み" size="small" fullWidth 
                                InputLabelProps={{ shrink: true }} 
                                value={filterDate} onChange={(e) => setFilterDate(e.target.value)} 
                            />
                        </Paper>
                        <Stack spacing={2}>
                            {reports.map((report) => (
                                <Card key={report.id} variant="outlined" sx={{ borderRadius: 2 }}>
                                    <CardActionArea onClick={() => handleEdit(report)} sx={{ p: 2 }}>
                                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                                            <Box>
                                                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                    <AccessTimeIcon fontSize="small" color="action" />
                                                    <Typography variant="body2" fontWeight="bold">
                                                        {new Date(report.start_at).toLocaleDateString()} {new Date(report.start_at).getHours()}:{String(new Date(report.start_at).getMinutes()).padStart(2,'0')}
                                                    </Typography>
                                                    <Chip 
                                                        label={report.status === 'approved' ? '承認済' : report.status === 'remanded' ? '差戻し' : '未承認'} 
                                                        color={report.status === 'approved' ? 'success' : report.status === 'remanded' ? 'error' : 'warning'} 
                                                        size="small" sx={{ height: 20, fontSize: '0.7rem' }}
                                                    />
                                                </Box>
                                                <Typography variant="h6" fontWeight="bold">{report.clients?.name} 様</Typography>
                                            </Box>
                                            <EditIcon color="action" />
                                        </Stack>
                                    </CardActionArea>
                                </Card>
                            ))}
                            {reports.length === 0 && (
                                <Box textAlign="center" py={5} color="text.secondary">
                                    <Typography>記録がありません</Typography>
                                </Box>
                            )}
                        </Stack>
                    </>
                )}

                {viewMode === 1 && (
                    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                            <IconButton onClick={() => handleMonthChange(-1)}><ChevronLeftIcon /></IconButton>
                            <Typography variant="h6" fontWeight="bold">
                                {currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月
                            </Typography>
                            <IconButton onClick={() => handleMonthChange(1)}><ChevronRightIcon /></IconButton>
                        </Box>
                        <Divider sx={{ mb: 2 }} />
                        {/* リファクタリング: カレンダー描画UIを呼び出しに変更 */}
                        <HistoryCalendar 
                            year={currentMonth.getFullYear()} 
                            month={currentMonth.getMonth()} 
                            events={reports} 
                            onSelect={handleEdit} 
                        />
                    </Paper>
                )}
            </Box>
        </Box>
    );
}