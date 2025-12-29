// app/admin/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Stack, CircularProgress, Grid
} from '@mui/material';
import { supabase } from '@/lib/supabase';

export default function AdminDashboard() {
    const [stats, setStats] = useState({
        todayVisits: 0,
        unapproved: 0,
        activeStaff: 0
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from('profiles')
                .select('organization_id')
                .eq('id', user.id)
                .single();

            if (!profile) return;
            const orgId = profile.organization_id;

            // 日付範囲の設定 (今日)
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

            // 1. 本日の訪問数 (start_at が今日)
            const { count: todayCount } = await supabase
                .from('reports')
                .select('*', { count: 'exact', head: true })
                .eq('clients.organization_id', orgId) // クライアント経由で絞り込みが必要だが、RLSがあれば reports だけでいける場合も。念のため結合せず取れるか確認
                // 注: reportsテーブルにorganization_idがない場合、clientsとjoinして絞り込むのが正確だが、
                // 簡易的に全レポート取得後にフィルタリングするか、RLSを信じる。
                // ここではRLSが効いている前提（自分の事業所のデータしか取れない）で書きます。
                .gte('start_at', todayStart)
                .lte('start_at', todayEnd);

            // 2. 未承認の記録 (全期間)
            const { count: pendingCount } = await supabase
                .from('reports')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            // 3. スタッフ稼働中 (今日記録があるヘルパーのユニーク数)
            // count(distinct) はSupabase JSクライアントで直接やりづらいため、データ取得して数える
            const { data: activeData } = await supabase
                .from('reports')
                .select('helper_id')
                .gte('start_at', todayStart)
                .lte('start_at', todayEnd);

            // 重複を除去してカウント
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
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box>
            <Typography variant="h5" fontWeight="bold" gutterBottom sx={{ mb: 4 }}>
                本日の概況
            </Typography>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>

                {/* カード1 */}
                <Paper
                    elevation={0}
                    sx={{
                        p: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        height: 160,
                        flex: 1,
                        border: '1px solid #e0e0e0',
                        borderRadius: 3,
                        bgcolor: '#fff'
                    }}
                >
                    <Typography component="h2" variant="h6" color="primary.main" gutterBottom fontWeight="bold">
                        本日の訪問予定
                    </Typography>
                    <Typography component="p" variant="h3" fontWeight="500">
                        {stats.todayVisits} <span style={{ fontSize: '1.5rem', color: '#666' }}>件</span>
                    </Typography>
                </Paper>

                {/* カード2 */}
                <Paper
                    elevation={0}
                    sx={{
                        p: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        height: 160,
                        flex: 1,
                        border: '1px solid #e0e0e0',
                        borderRadius: 3,
                        bgcolor: '#fff'
                    }}
                >
                    <Typography component="h2" variant="h6" color="error.main" gutterBottom fontWeight="bold">
                        未承認の記録
                    </Typography>
                    <Typography component="p" variant="h3" fontWeight="500" color="error.main">
                        {stats.unapproved} <span style={{ fontSize: '1.5rem', color: '#666' }}>件</span>
                    </Typography>
                </Paper>

                {/* カード3 */}
                <Paper
                    elevation={0}
                    sx={{
                        p: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        height: 160,
                        flex: 1,
                        border: '1px solid #e0e0e0',
                        borderRadius: 3,
                        bgcolor: '#fff'
                    }}
                >
                    <Typography component="h2" variant="h6" color="text.secondary" gutterBottom fontWeight="bold">
                        スタッフ稼働中
                    </Typography>
                    <Typography component="p" variant="h3" fontWeight="500">
                        {stats.activeStaff} <span style={{ fontSize: '1.5rem', color: '#666' }}>名</span>
                    </Typography>
                </Paper>

            </Stack>
        </Box>
    );
}