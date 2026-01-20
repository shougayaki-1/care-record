'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, Typography, Paper, Stack, CircularProgress } from '@mui/material';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';

// 集計用データの型
type ReportData = {
    helper_id: string;
    clients: {
        organization_id: string;
    };
};

export default function DashboardPage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const router = useRouter();
    const [stats, setStats] = useState({ todayVisits: 0, unapproved: 0, activeStaff: 0 });
    const [loading, setLoading] = useState(true);

    const fetchStats = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

            // 1. 本日の訪問数
            const { count: todayCount } = await supabase
                .from('reports')
                .select('*, clients!inner(organization_id)', { count: 'exact', head: true })
                .eq('clients.organization_id', currentOrg.id)
                .gte('start_at', todayStart)
                .lte('start_at', todayEnd);

            // 2. 未承認の記録
            const { count: pendingCount } = await supabase
                .from('reports')
                .select('*, clients!inner(organization_id)', { count: 'exact', head: true })
                .eq('clients.organization_id', currentOrg.id)
                .eq('status', 'pending');

            // 3. スタッフ稼働中
            // selectの戻り値を型指定
            const { data } = await supabase
                .from('reports')
                .select('helper_id, clients!inner(organization_id)')
                .eq('clients.organization_id', currentOrg.id)
                .gte('start_at', todayStart)
                .lte('start_at', todayEnd);

            // 型アサーションで明示
            const activeData = data as unknown as ReportData[] | null;
            const uniqueHelpers = new Set(activeData?.map(d => d.helper_id)).size;

            setStats({
                todayVisits: todayCount || 0,
                unapproved: pendingCount || 0,
                activeStaff: uniqueHelpers
            });
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [currentOrg]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            if (currentOrg.role === 'staff') {
                router.push('/app/record');
                return;
            }
            fetchStats();
        }
    }, [wsLoading, currentOrg, router, fetchStats]);

    if (loading || wsLoading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box>
            <Typography variant="h5" fontWeight="bold" gutterBottom sx={{ mb: 4 }}>
                本日の概況
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                <Paper elevation={0} sx={{ p: 3, flex: 1, border: '1px solid #e0e0e0', borderRadius: 3 }}>
                    <Typography variant="h6" color="primary.main" fontWeight="bold">本日の訪問予定</Typography>
                    <Typography variant="h3" fontWeight="500">{stats.todayVisits} <span style={{ fontSize: '1.5rem', color: '#666' }}>件</span></Typography>
                </Paper>
                <Paper elevation={0} sx={{ p: 3, flex: 1, border: '1px solid #e0e0e0', borderRadius: 3 }}>
                    <Typography variant="h6" color="error.main" fontWeight="bold">未承認の記録</Typography>
                    <Typography variant="h3" fontWeight="500" color="error.main">{stats.unapproved} <span style={{ fontSize: '1.5rem', color: '#666' }}>件</span></Typography>
                </Paper>
                <Paper elevation={0} sx={{ p: 3, flex: 1, border: '1px solid #e0e0e0', borderRadius: 3 }}>
                    <Typography variant="h6" color="text.secondary" fontWeight="bold">スタッフ稼働中</Typography>
                    <Typography variant="h3" fontWeight="500">{stats.activeStaff} <span style={{ fontSize: '1.5rem', color: '#666' }}>名</span></Typography>
                </Paper>
            </Stack>
        </Box>
    );
}