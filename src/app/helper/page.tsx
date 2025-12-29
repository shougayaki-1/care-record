'use client';

import { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Card,
    CardActionArea,
    CardContent,
    Stack,
    AppBar,
    Toolbar,
    Container,
    Avatar,
    CircularProgress,
    Button,
    Chip,
    Alert,
    IconButton
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import HistoryIcon from '@mui/icons-material/History';
import DashboardIcon from '@mui/icons-material/Dashboard'; // 追加
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Client = {
    id: string;
    name: string;
};

export default function HelperHome() {
    const router = useRouter();
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState<'owner' | 'manager' | 'staff' | 'super_admin' | null>(null);
    const [userName, setUserName] = useState('');

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) {
                router.push('/');
                return;
            }

            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('organization_id, role, name')
                .eq('id', user.id)
                .single();

            if (profileError || !profile) return;

            setUserRole(profile.role as any);
            setUserName(profile.name);

            let targetClients: Client[] = [];

            // Owner, Manager, Super Admin の場合は全員表示
            if (['owner', 'manager', 'super_admin'].includes(profile.role)) {
                const { data } = await supabase
                    .from('clients')
                    .select('id, name')
                    .eq('organization_id', profile.organization_id)
                    .order('created_at', { ascending: false });
                targetClients = data || [];
            } else {
                // Staffの場合は担当のみ
                const { data } = await supabase
                    .from('assignments')
                    .select(`clients (id, name)`)
                    .eq('helper_id', user.id);

                if (data) {
                    targetClients = data.map((d: any) => d.clients).filter(Boolean);
                }
            }

            setClients(targetClients);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    // 管理者かどうか判定
    const isAdmin = ['owner', 'manager', 'super_admin'].includes(userRole || '');

    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', height: '100vh', alignItems: 'center' }}><CircularProgress /></Box>;

    return (
        <Box sx={{ bgcolor: '#f8f9fa', minHeight: '100vh', pb: 8 }}>
            <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#fff', color: '#333', borderBottom: '1px solid #e0e0e0' }}>
                <Toolbar>
                    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
                        <Typography variant="h6" fontWeight="bold" color="primary.main" sx={{ mr: 2 }}>
                            CareRecord
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                            {userName} さん ({userRole})
                        </Typography>
                    </Box>

                    {/* 管理者用：ダッシュボードに戻るボタン */}
                    {isAdmin && (
                        <Button
                            color="primary"
                            variant="outlined"
                            size="small"
                            startIcon={<DashboardIcon />}
                            onClick={() => router.push('/admin/dashboard')}
                            sx={{ mr: 2, fontWeight: 'bold', border: '1px solid #e0e0e0' }}
                        >
                            管理画面へ
                        </Button>
                    )}

                    {/* 履歴ボタン */}
                    <IconButton color="primary" onClick={() => router.push('/helper/history')} sx={{ mr: 1 }} title="提供記録履歴">
                        <HistoryIcon />
                    </IconButton>

                    {/* 設定ボタン */}
                    <IconButton color="inherit" onClick={() => router.push('/profile')} sx={{ mr: 1 }} title="アカウント設定">
                        <SettingsIcon />
                    </IconButton>

                    <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={handleLogout}>
                        ログアウト
                    </Button>
                </Toolbar>
            </AppBar>

            <Container maxWidth="sm" sx={{ mt: 3 }}>
                <Box sx={{ mb: 3 }}>
                    <Typography variant="h5" fontWeight="bold" gutterBottom>サービス提供記録</Typography>
                    <Typography variant="body2" color="text.secondary">記録を行う利用者を選択してください。</Typography>
                </Box>

                {isAdmin && (
                    <Alert severity="info" sx={{ mb: 3 }} icon={<AdminPanelSettingsIcon />}>
                        管理者権限のため、事業所の全利用者が表示されています。
                    </Alert>
                )}

                <Stack spacing={2}>
                    {clients.length === 0 ? (
                        <Box textAlign="center" py={5}><Typography color="text.secondary">利用者が表示されません</Typography></Box>
                    ) : (
                        clients.map((client) => (
                            <Card key={client.id} elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: 3 }}>
                                <CardActionArea onClick={() => router.push(`/helper/record/${client.id}`)} sx={{ p: 2 }}>
                                    <CardContent sx={{ p: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
                                        <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main' }}><PersonIcon /></Avatar>
                                        <Box>
                                            <Typography variant="h6" fontWeight="bold">{client.name} 様</Typography>
                                            <Chip label="記録を作成" size="small" color="primary" variant="outlined" sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }} />
                                        </Box>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        ))
                    )}
                </Stack>
            </Container>
        </Box>
    );
}