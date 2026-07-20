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
import TodayIcon from '@mui/icons-material/Today';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { InnerPageHeader, PageLayout, TablePageSkeleton } from '@/components/ui';
import { getMyShiftsWithStatus, type MyShiftItem } from '@/app/actions/shift';
import { checkRecordPermission, checkShiftPermission } from '@/utils/permissions';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';
import { buildRecordPath } from '@/utils/recordNavigation';

type Client = { id: string; name: string; };
type DraftReport = { id: string; created_at: string; };

export default function RecordSelectPage() {
    const router = useRouter();
    const { currentOrg, userId, loading: wsLoading } = useWorkspace();
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [clientDrafts, setClientDrafts] = useState<Record<string, DraftReport[]>>({});
    const [todayShifts, setTodayShifts] = useState<MyShiftItem[]>([]);

    const fetchData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            if (!userId) return;

            const canCreateAll = currentOrg.effectivePermissions.records.create === 'all';
            const canCreateAssigned = currentOrg.effectivePermissions.records.create === 'assigned';
            const canViewShifts = checkShiftPermission(currentOrg.effectivePermissions, 'view', true);

            // Step 1: clients and shifts in parallel (both need user but not each other)
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            end.setMilliseconds(end.getMilliseconds() - 1);

            const targetClients = await (async (): Promise<Client[]> => {
                if (canCreateAll) {
                    const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
                    return (data ?? []) as Client[];
                } else if (canCreateAssigned) {
                    const { data } = await supabase.from('assignments').select('clients(id, name)').eq('helper_id', userId);
                    return ((data ?? []) as unknown as { clients: Client | null }[])
                        .map(d => d.clients).filter((c): c is Client => c !== null);
                }
                return [];
            })();

            setClients(targetClients);

            // getMyShiftsWithStatus is a withSafeError Server Action that CAN throw
            // (e.g. the acting user has no `staffs` row yet — a normal state for a
            // fresh organization). Fetch it separately so that failure never
            // discards the clients list above. Mirrors d7aff24 / ccd1837.
            if (canViewShifts) {
                try {
                    const shiftsResult = await getMyShiftsWithStatus(currentOrg.id, start.toISOString(), end.toISOString());
                    setTodayShifts(shiftsResult.filter(s => s.status !== 'cancelled'));
                } catch (e) {
                    console.error('today shifts load failed:', e);
                }
            }

            // Step 2: drafts (needs client IDs from step 1)
            if (targetClients.length > 0) {
                const { data: drafts } = await supabase.from('reports')
                    .select('id, client_id, created_at')
                    .eq('helper_id', userId)
                    .eq('status', 'draft')
                    .is('deleted_at', null)
                    .in('client_id', targetClients.map(c => c.id))
                    .order('created_at', { ascending: false });
                const draftsMap: Record<string, DraftReport[]> = {};
                if (drafts) drafts.forEach((d) => {
                    if (!draftsMap[d.client_id]) draftsMap[d.client_id] = [];
                    draftsMap[d.client_id].push({ id: d.id, created_at: d.created_at });
                });
                setClientDrafts(draftsMap);
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [currentOrg, userId]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            queueMicrotask(() => void fetchData());
        }
    }, [wsLoading, currentOrg, fetchData]);

    const formatTime = (dateStr: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return isToday ? `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const formatShiftTime = (startAt: string, endAt: string) => {
        const start = new Date(startAt);
        const end = new Date(endAt);
        return `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')} - ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    };

    if (loading || wsLoading) return <TablePageSkeleton />;
    const canCreateAnyRecord = currentOrg ? checkRecordPermission(currentOrg.effectivePermissions, 'create', true) : false;

    return (
        <PageLayout>
            <InnerPageHeader icon={<EditNoteIcon />} title="記録を作成" />

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
                {todayShifts.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                            <TodayIcon color="primary" fontSize="small" />
                            <Typography variant="subtitle1" fontWeight="bold">今日の自分のシフト</Typography>
                        </Stack>
                        <Stack spacing={1.5}>
                            {todayShifts.map((shift) => (
                                <Card key={shift.id} variant="outlined" sx={{ borderRadius: 2, borderColor: shift.report ? 'divider' : 'primary.light' }}>
                                    <CardActionArea onClick={() => router.push(buildRecordPath(shift.client_id, { shiftId: shift.id }))} sx={{ p: { xs: 1.5, sm: 2 } }}>
                                        <Box display="flex" alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1.5}>
                                            <Box sx={{ minWidth: 0 }}>
                                                <Box display="flex" alignItems="center" gap={1} mb={0.5} flexWrap="wrap">
                                                    <Chip label={formatShiftTime(shift.start_at, shift.end_at)} color="primary" variant="outlined" size="small" />
                                                    {shift.report && (
                                                        <Chip label={getReportStatusLabel(shift.report.status)} color={getReportStatusChipColor(shift.report.status)} size="small" />
                                                    )}
                                                </Box>
                                                <Typography variant="h6" fontWeight="bold" sx={{ overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                                                    {shift.clients?.name ?? shift.title ?? 'シフト'} 様
                                                </Typography>
                                            </Box>
                                            <Box display="flex" alignItems="center" gap={1} color="primary.main" flexShrink={0}>
                                                <Typography variant="body2" fontWeight="bold" sx={{ display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}>
                                                    {shift.report ? '開く' : '記録作成'}
                                                </Typography>
                                                <ArrowForwardIosIcon sx={{ fontSize: 16 }} />
                                            </Box>
                                        </Box>
                                    </CardActionArea>
                                </Card>
                            ))}
                        </Stack>
                    </Box>
                )}

                <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ mb: 2 }}>利用者を選択</Typography>
                <Stack spacing={3}>
                    {clients.map((client) => {
                        const drafts = clientDrafts[client.id] || [];
                        return (
                            <Box key={client.id}>
                                <Card variant="outlined" sx={{ borderRadius: 1 }}>
                                    <CardActionArea onClick={() => router.push(buildRecordPath(client.id))} sx={{ p: { xs: 1.5, sm: 2 } }}>
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
                                                <CardActionArea onClick={() => router.push(buildRecordPath(client.id, { reportId: draft.id }))} sx={{ p: 1.5 }}>
                                                    <Stack spacing={0.5}>
                                                        <Box display="flex" alignItems="center" gap={1}>
                                                            <Chip label={getReportStatusLabel('draft')} color={getReportStatusChipColor('draft')} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
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
                    {clients.length === 0 && (
                        <Typography color="text.secondary" textAlign="center" mt={4}>
                            {canCreateAnyRecord ? '表示できる利用者がいません' : '記録を作成する権限がありません'}
                        </Typography>
                    )}
                </Stack>
            </Box>
        </PageLayout>
    );
}
