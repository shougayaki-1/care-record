'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, MenuItem, Paper, Stack, TextField, Typography,
} from '@/components/ui/mui';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import SaveIcon from '@mui/icons-material/Save';
import { DateTimeField, InnerPageHeader } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import {
  listMyInternalWorkRecords,
  saveInternalWork,
  type InternalWorkRecord,
} from '@/app/actions/internalWork';

const WORK_TYPES = [
  { value: 'meeting', label: '会議' },
  { value: 'training', label: '研修' },
  { value: 'office', label: '事務作業' },
  { value: 'recording', label: '記録作成' },
  { value: 'other', label: 'その他' },
];

function formatDatetimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  const [title, setTitle] = useState('会議');
  const [workType, setWorkType] = useState('meeting');
  const [startAt, setStartAt] = useState(() => formatDatetimeLocal(now));
  const [endAt, setEndAt] = useState(() => formatDatetimeLocal(new Date(now.getTime() + 60 * 60 * 1000)));
  const [workHours, setWorkHours] = useState('1');
  const [note, setNote] = useState('');
  const [targetMonth, setTargetMonth] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [records, setRecords] = useState<InternalWorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) {
      const hours = (end.getTime() - start.getTime()) / 3600000;
      setWorkHours(String(Math.round(hours * 100) / 100));
    }
  }, [startAt, endAt]);

  const handleSave = async () => {
    if (!currentOrg) return;
    setSaving(true);
    try {
      await saveInternalWork({
        organizationId: currentOrg.id,
        title,
        workType,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        workHours: Number(workHours),
        note,
      });
      showToast('内勤実績を保存しました', 'success');
      setNote('');
      await loadRecords();
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : '保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (wsLoading || !currentOrg) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <InnerPageHeader icon={<WorkHistoryIcon />} title="内勤を記録" />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
        <Stack spacing={3} maxWidth={760} mx="auto">
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
            <Stack spacing={2}>
              <Alert severity="info">会議・研修・事務作業など、利用者に紐づかない勤務実績を登録します。</Alert>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="件名" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
                <TextField select label="種別" value={workType} onChange={(e) => setWorkType(e.target.value)} sx={{ minWidth: { sm: 180 } }}>
                  {WORK_TYPES.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <DateTimeField value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>〜</Typography>
                <DateTimeField value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                <TextField
                  label="内勤時間"
                  type="number"
                  value={workHours}
                  onChange={(e) => setWorkHours(e.target.value)}
                  sx={{ minWidth: { sm: 140 } }}
                  slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.25' } }}
                />
              </Stack>
              <TextField label="メモ" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2} />
              <Box display="flex" justifyContent="flex-end">
                <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                  保存
                </Button>
              </Box>
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
    </Box>
  );
}
