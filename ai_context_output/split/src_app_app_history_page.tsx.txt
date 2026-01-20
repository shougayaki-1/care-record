'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Stack, IconButton, Chip, TextField, MenuItem, Tabs, Tab, Card, CardContent
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';

// 型定義
type Client = {
    id: string;
    name: string;
};

type Report = {
    id: string;
    start_at: string;
    status: 'pending' | 'approved' | 'remanded';
    client_id: string;
    clients: {
        name: string;
    } | null;
};

// 簡易カレンダーコンポーネント
type SimpleCalendarProps = {
    reports: Report[];
    onSelect: (r: Report) => void;
};

const SimpleCalendar = ({ reports }: SimpleCalendarProps) => {
    // onSelectは現在未使用のためデストラクチャリングから省略して警告回避
    return <Box p={2}>カレンダー表示機能は実装中です（該当件数: {reports.length}件）</Box>;
};

export default function HistoryPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const [viewMode, setViewMode] = useState(0);
    const [reports, setReports] = useState<Report[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [filterClient, setFilterClient] = useState('all');
    const [filterDate, setFilterDate] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            if (!currentOrg) return;
            const { data: { user } } = await supabase.auth.getUser();
            
            // クライアント一覧取得
            const { data: cl } = await supabase
                .from('clients')
                .select('id, name')
                .eq('organization_id', currentOrg.id);
            
            if (cl) setClients(cl);

            // レポート一覧取得
            let query = supabase
                .from('reports')
                .select(`
                    id,
                    start_at,
                    status,
                    client_id,
                    clients!inner(name, organization_id)
                `)
                .eq('helper_id', user?.id)
                .eq('clients.organization_id', currentOrg.id)
                .order('start_at', { ascending: false });

            if (filterClient !== 'all') {
                query = query.eq('client_id', filterClient);
            }
            if (filterDate) {
                query = query.gte('start_at', `${filterDate}T00:00:00`)
                             .lte('start_at', `${filterDate}T23:59:59`);
            }

            const { data } = await query;
            
            if (data) {
                // Supabaseからのデータを型に合わせてマッピング
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mappedReports: Report[] = data.map((d: any) => ({
                    id: d.id,
                    start_at: d.start_at,
                    status: d.status,
                    client_id: d.client_id,
                    clients: d.clients
                }));
                setReports(mappedReports);
            } else {
                setReports([]);
            }
        };

        if (!wsLoading && currentOrg) {
            fetchData();
        }
    }, [wsLoading, currentOrg, filterClient, filterDate]);

    const handleEdit = (report: Report) => {
        router.push(`/app/record/${report.client_id}?reportId=${report.id}`);
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box>
            <Typography variant="h5" fontWeight="bold" mb={3}>提供記録履歴</Typography>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={2}>
                    <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} variant="fullWidth">
                        <Tab icon={<ListIcon />} label="リスト" />
                        <Tab icon={<CalendarMonthIcon />} label="カレンダー" />
                    </Tabs>
                    <Stack direction="row" spacing={1}>
                        <TextField 
                            select 
                            label="利用者" 
                            size="small" 
                            fullWidth 
                            value={filterClient} 
                            onChange={(e) => setFilterClient(e.target.value)}
                        >
                            <MenuItem value="all">全員</MenuItem>
                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                        </TextField>
                        <TextField 
                            type="date" 
                            label="日付" 
                            size="small" 
                            fullWidth 
                            InputLabelProps={{ shrink: true }} 
                            value={filterDate} 
                            onChange={(e) => setFilterDate(e.target.value)} 
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
                                        <Typography variant="h6" fontWeight="bold">
                                            {report.clients?.name}
                                        </Typography>
                                        <Chip 
                                            label={report.status === 'approved' ? '承認済' : '未承認'} 
                                            color={report.status === 'approved' ? 'success' : 'default'} 
                                            size="small" 
                                            variant="outlined" 
                                        />
                                    </Box>
                                    <IconButton color="primary" onClick={() => handleEdit(report)}>
                                        <EditIcon />
                                    </IconButton>
                                </Stack>
                            </CardContent>
                        </Card>
                    ))}
                    {reports.length === 0 && <Typography textAlign="center">記録がありません</Typography>}
                </Stack>
            ) : (
                <SimpleCalendar reports={reports} onSelect={handleEdit} />
            )}
        </Box>
    );
}