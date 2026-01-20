'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, Typography, Card, CardActionArea, Stack, Avatar, CircularProgress } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';

// クライアントの型定義
type Client = {
    id: string;
    name: string;
};

// 割り当て情報の型定義 (Supabaseからの戻り値用)
type AssignmentRow = {
    clients: Client | null;
};

export default function RecordSelectPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: { user } } = await supabase.auth.getUser();
            let targetClients: Client[] = [];

            if (['owner', 'manager'].includes(currentOrg.role)) {
                // 管理者は全員
                const { data } = await supabase
                    .from('clients')
                    .select('id, name')
                    .eq('organization_id', currentOrg.id);
                
                if (data) {
                    targetClients = data as Client[];
                }
            } else {
                // スタッフは担当のみ
                const { data } = await supabase
                    .from('assignments')
                    .select('clients(id, name)')
                    .eq('helper_id', user?.id);
                
                if (data) {
                    // unknownを経由して型安全に処理
                    const assignments = data as unknown as AssignmentRow[];
                    targetClients = assignments
                        .map((d) => d.clients)
                        .filter((c): c is Client => c !== null);
                }
            }
            setClients(targetClients);
        } catch (e) { 
            console.error(e); 
        } finally { 
            setLoading(false); 
        }
    }, [currentOrg]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchData();
        }
    }, [wsLoading, currentOrg, fetchData]);

    if (loading || wsLoading) return <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>;

    return (
        <Box>
            <Typography variant="h5" fontWeight="bold" mb={3}>記録を作成する利用者を選択</Typography>
            <Stack spacing={2}>
                {clients.map((client) => (
                    <Card key={client.id} variant="outlined" sx={{ borderRadius: 3 }}>
                        <CardActionArea onClick={() => router.push(`/app/record/${client.id}`)} sx={{ p: 2 }}>
                            <Box display="flex" alignItems="center" gap={2}>
                                <Avatar sx={{ bgcolor: 'primary.light' }}><PersonIcon /></Avatar>
                                <Typography variant="h6">{client.name} 様</Typography>
                            </Box>
                        </CardActionArea>
                    </Card>
                ))}
                {clients.length === 0 && (
                    <Typography color="text.secondary">表示できる利用者がいません</Typography>
                )}
            </Stack>
        </Box>
    );
}