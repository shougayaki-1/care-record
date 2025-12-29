// src/app/helper/history/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Stack, IconButton, Chip,
    Container, TextField, MenuItem, Tabs, Tab, Card, CardContent
} from '@mui/material';
// Grid2のインポートを削除し、Boxのみを使用
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';

// 簡易カレンダーコンポーネント (CSS Grid版)
const SimpleCalendar = ({ reports, onSelect }: { reports: any[], onSelect: (r: any) => void }) => {
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const today = new Date();

    return (
        // MUIのGridコンポーネントを使わず、BoxのCSS Gridで7列レイアウトを作成
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {[...Array(daysInMonth)].map((_, i) => {
                const day = i + 1;
                const dayReports = reports.filter(r => new Date(r.start_at).getDate() === day);
                const isToday = day === today.getDate();

                return (
                    <Box key={day}>
                        <Paper
                            variant="outlined"
                            sx={{
                                minHeight: 60,
                                p: 0.5,
                                textAlign: 'center',
                                bgcolor: dayReports.length > 0 ? '#e3f2fd' : 'transparent',
                                borderColor: isToday ? 'primary.main' : 'divider',
                                borderWidth: isToday ? 2 : 1,
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            <Typography variant="caption" display="block" fontWeight="bold" color={isToday ? 'primary' : 'textPrimary'}>
                                {day}
                            </Typography>

                            <Stack spacing={0.5} sx={{ flexGrow: 1, overflowY: 'auto' }}>
                                {dayReports.map(r => (
                                    <Box
                                        key={r.id}
                                        onClick={() => onSelect(r)}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: '#fff',
                                            borderRadius: 0.5,
                                            fontSize: '0.6rem',
                                            p: 0.2,
                                            cursor: 'pointer',
                                            overflow: 'hidden',
                                            whiteSpace: 'nowrap',
                                            textOverflow: 'ellipsis'
                                        }}
                                    >
                                        {r.clients?.name}
                                    </Box>
                                ))}
                            </Stack>
                        </Paper>
                    </Box>
                );
            })}
        </Box>
    );
};

export default function HelperHistoryPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [viewMode, setViewMode] = useState(0);
    const [reports, setReports] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [clients, setClients] = useState<any[]>([]);
    const [filterClient, setFilterClient] = useState('all');
    const [filterDate, setFilterDate] = useState('');

    useEffect(() => {
        fetchData();
    }, [filterClient, filterDate]);

    const fetchData = async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
        if (profile) {
            const { data: cl } = await supabase.from('clients').select('id, name').eq('organization_id', profile.organization_id);
            setClients(cl || []);
        }

        let query = supabase
            .from('reports')
            .select(`*, clients(name)`)
            .eq('helper_id', user.id)
            .order('start_at', { ascending: false });

        if (filterClient !== 'all') query = query.eq('client_id', filterClient);
        if (filterDate) query = query.gte('start_at', `${filterDate}T00:00:00`).lte('start_at', `${filterDate}T23:59:59`);

        const { data } = await query;
        setReports(data || []);
        setLoading(false);
    };

    const handleEdit = (report: any) => {
        router.push(`/helper/record/${report.client_id}?reportId=${report.id}`);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('本当に削除しますか？')) return;
        try {
            await supabase.from('reports').delete().eq('id', id);
            showToast('削除しました');
            fetchData();
        } catch (e) {
            showToast('削除に失敗しました', 'error');
        }
    };

    return (
        <Box sx={{ bgcolor: '#f5f5f5', minHeight: '100vh', pb: 4 }}>
            <Container maxWidth="md" sx={{ pt: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                    <IconButton onClick={() => router.push('/helper')}><ArrowBackIcon /></IconButton>
                    <Typography variant="h5" fontWeight="bold">提供記録履歴</Typography>
                </Stack>

                <Paper sx={{ p: 2, mb: 2 }}>
                    <Stack spacing={2}>
                        <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} variant="fullWidth">
                            <Tab icon={<ListIcon />} label="リスト" />
                            <Tab icon={<CalendarMonthIcon />} label="カレンダー" />
                        </Tabs>
                        <Stack direction="row" spacing={1}>
                            <TextField
                                select label="利用者" size="small" fullWidth
                                value={filterClient} onChange={(e) => setFilterClient(e.target.value)}
                            >
                                <MenuItem value="all">全員</MenuItem>
                                {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                            </TextField>
                            <TextField
                                type="date" label="日付" size="small" fullWidth InputLabelProps={{ shrink: true }}
                                value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                            />
                        </Stack>
                    </Stack>
                </Paper>

                {viewMode === 0 ? (
                    <Stack spacing={2}>
                        {reports.map((report) => (
                            <Card key={report.id}>
                                <CardContent sx={{ pb: 1 }}>
                                    <Stack direction="row" justifyContent="space-between">
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">
                                                {new Date(report.start_at).toLocaleDateString()}
                                            </Typography>
                                            <Typography variant="h6" fontWeight="bold">{report.clients?.name}</Typography>
                                            <Chip
                                                label={report.status === 'approved' ? '承認済' : report.status === 'remanded' ? '差戻し' : '未承認'}
                                                color={report.status === 'approved' ? 'success' : report.status === 'remanded' ? 'error' : 'default'}
                                                size="small" variant="outlined"
                                            />
                                        </Box>
                                        <Stack>
                                            <IconButton color="primary" onClick={() => handleEdit(report)}><EditIcon /></IconButton>
                                            <IconButton color="error" onClick={() => handleDelete(report.id)}><DeleteIcon /></IconButton>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        ))}
                        {reports.length === 0 && <Typography textAlign="center">記録がありません</Typography>}
                    </Stack>
                ) : (
                    <SimpleCalendar reports={reports} onSelect={handleEdit} />
                )}
            </Container>
        </Box>
    );
}