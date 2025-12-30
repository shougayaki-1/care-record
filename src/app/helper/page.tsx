// app/helper/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Card,
    CardActionArea,
    CardContent,
    Stack,
    Container,
    Avatar,
    CircularProgress,
    Chip,
    Alert
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
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
    const [userRole, setUserRole] = useState<string>('');
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

            setUserRole(profile.role);
            setUserName(profile.name);

            let targetClients: Client[] = [];

            // 権限による出し分けロジック
            if (['owner', 'manager', 'super_admin'].includes(profile.role)) {
                // 管理者権限：事業所の全員を表示
                const { data } = await supabase
                    .from('clients')
                    .select('id, name')
                    .eq('organization_id', profile.organization_id)
                    .order('created_at', { ascending: false });
                targetClients = data || [];
            } else {
                // 一般スタッフ：担当割り当てられている人のみ表示
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
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="sm" sx={{ py: 4 }}>
            <Box sx={{ mb: 4 }}>
                <Typography
                    variant="h4"
                    sx={{
                        fontFamily: 'var(--font-poppins)',
                        fontWeight: 900,
                        color: '#2255CC',
                        mb: 1
                    }}
                >
                    CareRecord
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>記録を始める</Typography>
                <Typography variant="body2" color="text.secondary">
                    サービス提供を行う利用者を選択してください。
                </Typography>
            </Box>

            {/* 管理者用インフォメーション */}
            {['owner', 'manager', 'super_admin'].includes(userRole) && (
                <Alert severity="info" sx={{ mb: 3, borderRadius: 3 }} icon={<AdminPanelSettingsIcon />}>
                    あなたは管理者権限のため、事業所の全利用者が表示されています。
                </Alert>
            )}

            {/* 利用者リスト */}
            <Stack spacing={2}>
                {clients.length === 0 ? (
                    <Box textAlign="center" py={10}>
                        <Typography color="text.secondary">表示できる利用者がいません</Typography>
                    </Box>
                ) : (
                    clients.map((client) => (
                        <Card
                            key={client.id}
                            elevation={0}
                            sx={{
                                border: '1px solid #e0e0e0',
                                borderRadius: 4,
                                overflow: 'hidden'
                            }}
                        >
                            <CardActionArea onClick={() => router.push(`/helper/record/${client.id}`)} sx={{ p: 2.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                                    <Avatar
                                        sx={{
                                            bgcolor: 'primary.light',
                                            color: 'primary.main',
                                            width: 56,
                                            height: 56,
                                            fontSize: '1.5rem'
                                        }}
                                    >
                                        <PersonIcon />
                                    </Avatar>
                                    <Box>
                                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                                            {client.name} 様
                                        </Typography>
                                        <Chip
                                            label="記録作成"
                                            size="small"
                                            color="primary"
                                            sx={{ mt: 0.5, fontWeight: 'bold' }}
                                        />
                                    </Box>
                                </Box>
                            </CardActionArea>
                        </Card>
                    ))
                )}
            </Stack>
        </Container>
    );
}