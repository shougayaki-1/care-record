'use client';

import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';

import { useCallback, useState } from 'react';
import {
    Alert, Box, Typography, Paper, Stack, TextField, Tabs, Tab, Divider,
    Grid, IconButton, Tooltip
} from '@/components/ui/mui';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import HistoryIcon from '@mui/icons-material/History';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { AppButton, CalendarPageSkeleton, InnerPageHeader, PageLayout } from '@/components/ui';
import { getMyRecordFeed } from '@/app/actions/recordFeed';
import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import { useRecordQuery } from '@/hooks/useRecordQuery';
import type { RecordFeedItem } from '@/utils/recordFeed';
import { RecordFeedCard } from '@/components/record/RecordFeedCard';

const EMPTY_FEED: RecordFeedItem[] = [];
const logFeedError = (error: unknown) => console.error('Failed to load own record history', error);

// 簡易カレンダーコンポーネント
const SimpleCalendar = ({ year, month, events, onSelect }: { year: number, month: number, events: RecordFeedItem[], onSelect: (report: RecordFeedItem) => void }) => {
    const firstDay = new Date(year, month, 1).getDay(); // 0: Sun, 1: Mon...
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // カレンダーのマス目作成
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    return (
        <Grid container spacing={1}>
            {/* ★修正: Grid item を削除し、xs を size に変更 (MUI v6対応) */}
            {['日','月','火','水','木','金','土'].map(d => (
                <Grid size={{ xs: 12/7 }} key={d} textAlign="center" fontWeight="bold" fontSize={12} color="text.secondary" sx={{ py: 1 }}>{d}</Grid>
            ))}
            {days.map((d, i) => {
                const dayEvents = d ? events.filter(e => new Date(e.startAt).getDate() === d) : [];
                return (
                    <Grid size={{ xs: 12/7 }} key={i}>
                        <Box 
                            sx={{ 
                                height: 80, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5,
                                bgcolor: d ? 'white' : 'transparent',
                                display: 'flex', flexDirection: 'column'
                            }}
                        >
                            {d && (
                                <>
                                    <Typography variant="caption" fontWeight="bold" color={new Date().getDate() === d && year === new Date().getFullYear() && month === new Date().getMonth() ? 'primary' : 'textSecondary'}>
                                        {d}
                                    </Typography>
                                    <Box sx={{ flexGrow: 1, overflowY: 'auto', '::-webkit-scrollbar': {width:0} }}>
                                        {dayEvents.map(ev => (
                                            <Tooltip key={`${ev.kind}:${ev.id}`} title={`${new Date(ev.startAt).getHours()}:${String(new Date(ev.startAt).getMinutes()).padStart(2,'0')} ${ev.title}`}>
                                                <Box 
                                                    onClick={() => onSelect(ev)}
                                                    sx={{ 
                                                        bgcolor: ev.status === 'approved' ? 'background.success' : (ev.status === 'remanded' ? 'background.danger' : 'background.warning'),
                                                        fontSize: 10, p: 0.2, borderRadius: 0.5, mb: 0.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                                        cursor: 'pointer',
                                                        '&:hover': { filter: 'brightness(0.95)' }
                                                    }}
                                                >
                                                    {ev.title}
                                                </Box>
                                            </Tooltip>
                                        ))}
                                    </Box>
                                </>
                            )}
                        </Box>
                    </Grid>
                );
            })}
        </Grid>
    );
};

export default function HistoryPage() {
    const router = useRouter();
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const [viewMode, setViewMode] = useState(0); // 0: List, 1: Calendar
    const [filterDate, setFilterDate] = useState('');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const startAt = viewMode === 0 ? (filterDate ? `${filterDate}T00:00:00+09:00` : undefined) : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString();
    const endAt = viewMode === 0 ? (filterDate ? new Date(Date.parse(`${filterDate}T00:00:00+09:00`) + 86400000).toISOString() : undefined) : new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1).toISOString();
    const organizationId = currentOrg?.id;
    const load = useCallback(() => readActionResult(getMyRecordFeed(organizationId!, { startAt, endAt })), [organizationId, startAt, endAt]);
    const { data: records, loading, error: loadError, refresh } = useRecordQuery({ organizationId: wsLoading ? undefined : organizationId, queryKey: `${startAt ?? ''}/${endAt ?? ''}`, load, empty: EMPTY_FEED, onError: logFeedError, refreshInterval: 30000 });
    const handleEdit = (record: RecordFeedItem) => { if (record.href) router.push(record.href); };

    const handleMonthChange = (diff: number) => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + diff, 1));
    };

    if (wsLoading || !currentOrg) return <CalendarPageSkeleton />;

    return (
        <PageLayout>
            <InnerPageHeader
                icon={<HistoryIcon />}
                title="履歴"
                actions={(
                <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)} sx={{ minHeight: 0 }}>
                    <Tab icon={<ListIcon />} label="リスト" sx={{ py: 1, minHeight: 0 }} />
                    <Tab icon={<CalendarMonthIcon />} label="カレンダー" sx={{ py: 1, minHeight: 0 }} />
                </Tabs>
                )}
            />

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
                {loading && <Typography>読み込み中...</Typography>}
                {loadError != null && <Alert severity="error" action={needsActionRecovery(loadError) ? <RecoveryLogoutButton /> : <AppButton variant="text" intent="secondary" onClick={() => void refresh()}>再試行</AppButton>}>{getActionErrorMessage(loadError)}</Alert>}
                {viewMode === 0 && !loading && loadError == null && (
                    <>
                        <Paper sx={{ p: 2, mb: 2 }}>
                            <TextField 
                                type="date" label="日付絞り込み" size="small" fullWidth 
                                slotProps={{ inputLabel: { shrink: true } }}
                                value={filterDate} onChange={(e) => setFilterDate(e.target.value)} 
                            />
                        </Paper>
                        <Stack spacing={2}>
                            {records.map((item) => <RecordFeedCard key={`${item.kind}:${item.id}`} item={item} onSelect={handleEdit} />)}
                            {records.length === 0 && (
                                <Box textAlign="center" py={5} color="text.secondary">
                                    <Typography>記録がありません</Typography>
                                </Box>
                            )}
                        </Stack>
                    </>
                )}

                {viewMode === 1 && !loading && loadError == null && (
                    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                            <IconButton onClick={() => handleMonthChange(-1)}><ChevronLeftIcon /></IconButton>
                            <Typography variant="h6" fontWeight="bold">
                                {currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月
                            </Typography>
                            <IconButton onClick={() => handleMonthChange(1)}><ChevronRightIcon /></IconButton>
                        </Box>
                        <Divider sx={{ mb: 2 }} />
                        <SimpleCalendar 
                            year={currentMonth.getFullYear()} 
                            month={currentMonth.getMonth()} 
                            events={records}
                            onSelect={handleEdit} 
                        />
                    </Paper>
                )}
            </Box>
        </PageLayout>
    );
}
