'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Stack, Chip, TextField, Tabs, Tab, Card, CardActionArea, Divider,
    Grid, IconButton, Tooltip
} from '@/components/ui/mui';
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
import { InnerPageHeader } from '@/components/ui';

type Report = {
    id: string; start_at: string; status: 'pending' | 'approved' | 'remanded';
    client_id: string; clients: { name: string; } | null;
};

// 簡易カレンダーコンポーネント
const SimpleCalendar = ({ year, month, events, onSelect }: { year: number, month: number, events: Report[], onSelect: (report: Report) => void }) => {
    const firstDay = new Date(year, month, 1).getDay(); // 0: Sun, 1: Mon...
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // カレンダーのマス目作成
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    return (
        <Grid container spacing={1}>
            {/* ★修正: Grid item を削除し、xs を size に変更 (MUI v6対応) */}
            {['日','月','火','水','木','金','土'].map(d => (
                <Grid size={{ xs: 12/7 }} key={d} textAlign="center" fontWeight="bold" fontSize={12} color="text.secondary" sx={{ py: 1 }}>{d}</Grid>
            ))}
            {days.map((d, i) => {
                const dayEvents = d ? events.filter(e => new Date(e.start_at).getDate() === d) : [];
                return (
                    <Grid size={{ xs: 12/7 }} key={i}>
                        <Box 
                            sx={{ 
                                height: 80, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5,
                                bgcolor: d ? 'white' : 'transparent',
                                display: 'flex', flexDirection: 'column'
                            }}
                        >
                            {d && (
                                <>
                                    <Typography variant="caption" fontWeight="bold" color={new Date().getDate() === d && year === new Date().getFullYear() && month === new Date().getMonth() ? 'primary' : 'textSecondary'}>
                                        {d}
                                    </Typography>
                                    <Box sx={{ flexGrow: 1, overflowY: 'auto', '::-webkit-scrollbar': {width:0} }}>
                                        {dayEvents.map(ev => (
                                            <Tooltip key={ev.id} title={`${new Date(ev.start_at).getHours()}:${String(new Date(ev.start_at).getMinutes()).padStart(2,'0')} ${ev.clients?.name}`}>
                                                <Box 
                                                    onClick={() => onSelect(ev)}
                                                    sx={{ 
                                                        bgcolor: ev.status === 'approved' ? 'background.success' : (ev.status === 'remanded' ? 'background.danger' : 'background.warning'),
                                                        fontSize: 10, p: 0.2, borderRadius: 0.5, mb: 0.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                                        cursor: 'pointer',
                                                        '&:hover': { filter: 'brightness(0.95)' }
                                                    }}
                                                >
                                                    {ev.clients?.name}
                                                </Box>
                                            </Tooltip>
                                        ))}
                                    </Box>
                                </>
                            )}
                        </Box>
                    </Grid>
                );
            })}
        </Grid>
    );
};

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
                .is('deleted_at', null)
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
            <InnerPageHeader
                icon={<HistoryIcon />}
                title="履歴"
                actions={(
                <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} sx={{ minHeight: 0 }}>
                    <Tab icon={<ListIcon />} label="リスト" sx={{ py: 1, minHeight: 0 }} />
                    <Tab icon={<CalendarMonthIcon />} label="カレンダー" sx={{ py: 1, minHeight: 0 }} />
                </Tabs>
                )}
            />

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
                {viewMode === 0 && (
                    <>
                        <Paper sx={{ p: 2, mb: 2 }}>
                            <TextField 
                                type="date" label="日付絞り込み" size="small" fullWidth 
                                slotProps={{ inputLabel: { shrink: true } }}
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
                        <SimpleCalendar 
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
