'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Stack, Chip, TextField, MenuItem, Tabs, Tab, Card, CardActionArea, Divider
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HistoryIcon from '@mui/icons-material/History';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';

type Client = { id: string; name: string; };
type ReportValueData = { _helpers?: string[]; [key: string]: unknown; };
type ReportValueRow = { data: ReportValueData; };
type Report = {
    id: string; start_at: string; status: 'pending' | 'approved' | 'remanded';
    client_id: string; clients: { name: string; } | null; report_values: ReportValueRow[];
};

export default function HistoryPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const [viewMode, setViewMode] = useState(0);
    const [reports, setReports] = useState<Report[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [filterClient, setFilterClient] = useState('all');
    const [filterDate, setFilterDate] = useState('');
    const [myProfileName, setMyProfileName] = useState('');

    useEffect(() => {
        const fetchUserAndData = async () => {
            if (!currentOrg) return;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).single();
            const myName = profile?.name || '';
            setMyProfileName(myName);

            const { data: cl } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
            if (cl) setClients(cl);

            let query = supabase.from('reports').select(`
                    id, start_at, status, client_id, clients!inner(name, organization_id), report_values(data)
                `).eq('clients.organization_id', currentOrg.id).neq('status', 'draft').order('start_at', { ascending: false });

            if (filterClient !== 'all') query = query.eq('client_id', filterClient);
            if (filterDate) query = query.gte('start_at', `${filterDate}T00:00:00`).lte('start_at', `${filterDate}T23:59:59`);
            else query = query.limit(200);

            const { data } = await query;
            
            if (data) {
                type RawReport = {
                    id: string; start_at: string; status: 'pending' | 'approved' | 'remanded';
                    client_id: string; clients: { name: string; } | null; 
                    report_values: { data: unknown }[] | { data: unknown } | null;
                };
                const rawData = data as unknown as RawReport[];
                
                const myReports: Report[] = rawData.filter(r => {
                    if (!r.report_values) return false;
                    let valueData: ReportValueData | undefined;
                    if (Array.isArray(r.report_values)) { if (r.report_values.length > 0) valueData = r.report_values[0].data as ReportValueData; } 
                    else valueData = r.report_values.data as ReportValueData;
                    if (!valueData) return false;
                    const helpers = valueData._helpers;
                    if (Array.isArray(helpers)) return helpers.includes(myName);
                    return false;
                }).map(d => {
                    let normalizedValues: ReportValueRow[] = [];
                    if (Array.isArray(d.report_values)) normalizedValues = d.report_values.map(v => ({ data: v.data as ReportValueData }));
                    else if (d.report_values) normalizedValues = [{ data: d.report_values.data as ReportValueData }];
                    return { id: d.id, start_at: d.start_at, status: d.status, client_id: d.client_id, clients: d.clients, report_values: normalizedValues };
                });
                setReports(myReports);
            } else setReports([]);
        };
        if (!wsLoading && currentOrg) fetchUserAndData();
    }, [wsLoading, currentOrg, filterClient, filterDate]);

    const handleEdit = (report: Report) => router.push(`/app/record/${report.client_id}?reportId=${report.id}`);

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
                <HistoryIcon sx={{ color: 'action.active', mr: 2 }} />
                <Typography variant="h6" fontWeight="bold" color="text.primary">自分の履歴</Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Stack spacing={2}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} sx={{ minHeight: 0 }}>
                                <Tab icon={<ListIcon />} label="リスト" sx={{ py: 1, minHeight: 0 }} />
                                <Tab icon={<CalendarMonthIcon />} label="カレンダー" sx={{ py: 1, minHeight: 0 }} disabled />
                            </Tabs>
                            {myProfileName && <Typography variant="caption" color="text.secondary">担当者: {myProfileName}</Typography>}
                        </Stack>
                        <Divider />
                        <Stack direction="row" spacing={1}>
                            <TextField select label="利用者" size="small" fullWidth value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                                <MenuItem value="all">全員</MenuItem>
                                {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                            </TextField>
                            <TextField type="date" label="日付" size="small" fullWidth InputLabelProps={{ shrink: true }} value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
                        </Stack>
                    </Stack>
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
                            <Typography>該当する記録がありません</Typography>
                            <Typography variant="caption">※担当ヘルパーにあなたの名前が含まれる記録のみ表示されます</Typography>
                        </Box>
                    )}
                </Stack>
            </Box>
        </Box>
    );
}