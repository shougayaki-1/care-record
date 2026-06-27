'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography,
} from '@/components/ui/mui';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import AddIcon from '@mui/icons-material/Add';
import { InnerPageHeader } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import {
  listMyInternalWorkRecords,
  type InternalWorkRecord,
} from '@/app/actions/internalWork';
import InternalWorkDialog from '@/components/internal-work/InternalWorkDialog';

function monthRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, mon, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function statusChip(status: InternalWorkRecord['status']) {
  if (status === 'approved') return <Chip label="承認済" color="success" size="small" />;
  if (status === 'remanded') return <Chip label="差戻し" color="error" size="small" />;
  return <Chip label="未承認" color="warning" size="small" />;
}

export default function InternalWorkPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const now = useMemo(() => new Date(), []);
  const [targetMonth, setTargetMonth] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [records, setRecords] = useState<InternalWorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);

  const loadRecords = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const { start, end } = monthRange(targetMonth);
      setRecords(await listMyInternalWorkRecords(currentOrg.id, start, end));
    } catch (e) {
      console.error(e);
      showToast('内勤実績の取得に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, targetMonth, showToast]);

  useEffect(() => {
    if (!wsLoading && currentOrg) void loadRecords();
  }, [wsLoading, currentOrg, loadRecords]);

  if (wsLoading || !currentOrg) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <InnerPageHeader icon={<WorkHistoryIcon />} title="内勤を記録" />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
        <Stack spacing={3} maxWidth={760} mx="auto">
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Alert severity="info" sx={{ flex: 1 }}>会議・研修・事務作業など、利用者に紐づかない勤務実績を登録します。</Alert>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenDialog(true)}>
                内勤を記録
              </Button>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <Box sx={{ p: 2, bgcolor: 'background.muted', borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
                <Typography fontWeight="bold">自分の内勤履歴</Typography>
                <TextField type="month" size="small" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Stack>
            </Box>
            <Stack divider={<Divider />}>
              {loading ? (
                <Box p={3} textAlign="center" color="text.secondary">読み込み中...</Box>
              ) : records.length === 0 ? (
                <Box p={3} textAlign="center" color="text.secondary">この月の内勤実績はありません</Box>
              ) : records.map((record) => (
                <Box key={record.id} sx={{ p: 2 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                    <Box minWidth={0}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{record.title}</Typography>
                        {statusChip(record.status)}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {new Date(record.start_at).toLocaleString('ja-JP')} 〜 {new Date(record.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                      </Typography>
                    </Box>
                    <Typography fontWeight="bold">{Number(record.work_hours).toFixed(2)}h</Typography>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Stack>
      </Box>
      <InternalWorkDialog open={openDialog} organizationId={currentOrg.id} onClose={() => setOpenDialog(false)} onSaved={loadRecords} />
    </Box>
  );
}
