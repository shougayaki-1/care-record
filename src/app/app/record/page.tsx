'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
    Box, Typography, Card, CardActionArea, Stack, Avatar,
    Chip
} from '@/components/ui/mui';
import PersonIcon from '@mui/icons-material/Person';
import EditNoteIcon from '@mui/icons-material/EditNote';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { InnerPageHeader } from '@/components/ui';

type Client = { id: string; name: string; };
type DraftReport = { id: string; created_at: string; };

export default function RecordSelectPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [clientDrafts, setClientDrafts] = useState<Record<string, DraftReport[]>>({});

    const fetchData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: { user } } = await supabase.auth.getUser();
            let targetClients: Client[] = [];

            if (['owner', 'manager'].includes(currentOrg.role)) {
                const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
                if (data) targetClients = data as Client[];
            } else {
                const { data } = await supabase.from('assignments').select('clients(id, name)').eq('helper_id', user?.id);
                if (data) {
                    const assignments = data as unknown as { clients: Client | null }[];
                    targetClients = assignments.map(d => d.clients).filter((c): c is Client => c !== null);
                }
            }
            setClients(targetClients);

            if (user && targetClients.length > 0) {
                const { data: drafts } = await supabase.from('reports').select('id, client_id, created_at').eq('helper_id', user.id).eq('status', 'draft').is('deleted_at', null).in('client_id', targetClients.map(c => c.id)).order('created_at', { ascending: false });
                const draftsMap: Record<string, DraftReport[]> = {};
                if (drafts) drafts.forEach((d) => { if (!draftsMap[d.client_id]) draftsMap[d.client_id] = []; draftsMap[d.client_id].push({ id: d.id, created_at: d.created_at }); });
                setClientDrafts(draftsMap);
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [currentOrg]);

    useEffect(() => { if (!wsLoading && currentOrg) fetchData(); }, [wsLoading, currentOrg, fetchData]);

    const formatTime = (dateStr: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return isToday ? `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    if (loading || wsLoading) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <InnerPageHeader icon={<EditNoteIcon />} title="記録を作成" />

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ mb: 2 }}>利用者を選択</Typography>
                <Stack spacing={3}>
                    {clients.map((client) => {
                        const drafts = clientDrafts[client.id] || [];
                        return (
                            <Box key={client.id}>
                                <Card variant="outlined" sx={{ borderRadius: 3 }}>
                                    <CardActionArea onClick={() => router.push(`/app/record/${client.id}`)} sx={{ p: { xs: 1.5, sm: 2 } }}>
                                        <Box display="flex" alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1.5}>
                                            <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
                                                <Avatar sx={{ bgcolor: 'primary.light', flexShrink: 0 }}><PersonIcon /></Avatar>
                                                <Typography variant="h6" fontWeight="bold" sx={{ overflowWrap: 'anywhere', lineHeight: 1.3 }}>{client.name} 様</Typography>
                                            </Box>
                                            <Box display="flex" alignItems="center" gap={1} color="primary.main" flexShrink={0}>
                                                <Typography variant="body2" fontWeight="bold" sx={{ display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}>新規作成</Typography>
                                                <AddCircleOutlineIcon />
                                            </Box>
                                        </Box>
                                    </CardActionArea>
                                </Card>

                                {drafts.length > 0 && (
                                    <Box sx={{ mt: 1.5, ml: { xs: 0, sm: 2 }, display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1, '&::-webkit-scrollbar': { display: 'none' } }}>
                                        {drafts.map((draft) => (
                                            <Card key={draft.id} variant="outlined" sx={{ minWidth: { xs: 'min(220px, 75vw)', sm: 200 }, flexShrink: 0, borderRadius: 2, bgcolor: 'background.warning', borderColor: 'warning.light' }}>
                                                <CardActionArea onClick={() => router.push(`/app/record/${client.id}?reportId=${draft.id}`)} sx={{ p: 1.5 }}>
                                                    <Stack spacing={0.5}>
                                                        <Box display="flex" alignItems="center" gap={1}>
                                                            <Chip label="作成中" color="warning" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                                                        </Box>
                                                        <Box display="flex" alignItems="center" gap={0.5} color="text.secondary">
                                                            <AccessTimeIcon sx={{ fontSize: 16 }} />
                                                            <Typography variant="caption" fontWeight="bold">編集: {formatTime(draft.created_at)}</Typography>
                                                        </Box>
                                                        <Typography variant="caption" color="primary.main" sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                                                            再開する <ArrowForwardIosIcon sx={{ fontSize: 10, ml: 0.5 }} />
                                                        </Typography>
                                                    </Stack>
                                                </CardActionArea>
                                            </Card>
                                        ))}
                                    </Box>
                                )}
                            </Box>
                        );
                    })}
                    {clients.length === 0 && <Typography color="text.secondary" textAlign="center" mt={4}>表示できる利用者がいません</Typography>}
                </Stack>
            </Box>
        </Box>
    );
}
