'use client';

import { useMemo, useState } from 'react';
import { Button, MenuItem, Stack, TextField, Typography } from '@/components/ui/mui';
import SaveIcon from '@mui/icons-material/Save';
import { AppDialog, DateTimeField } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { saveInternalWork } from '@/app/actions/internalWork';
import type { InternalWorkStaffOption } from '@/app/actions/internalWork';

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

export default function InternalWorkDialog({
  open,
  organizationId,
  staffOptions,
  onClose,
  onSaved,
}: {
  open: boolean;
  organizationId: string;
  staffOptions: InternalWorkStaffOption[];
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const now = useMemo(() => new Date(), []);
  const [title, setTitle] = useState('会議');
  const [workType, setWorkType] = useState('meeting');
  const [staffId, setStaffId] = useState('');
  const [startAt, setStartAt] = useState(() => formatDatetimeLocal(now));
  const [endAt, setEndAt] = useState(() => formatDatetimeLocal(new Date(now.getTime() + 60 * 60 * 1000)));
  const [workHours, setWorkHours] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveInternalWork({
        organizationId,
        staffId: staffId || staffOptions[0]?.id || null,
        title,
        workType,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        workHours: Number(workHours),
        note,
      });
      showToast('内勤実績を保存しました', 'success');
      setNote('');
      await onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : '保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="内勤を記録"
      maxWidth="sm"
      actions={(
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </>
      )}
    >
      <Stack spacing={2} pt={1}>
        <TextField
          select
          label="対象スタッフ"
          value={staffId || staffOptions[0]?.id || ''}
          onChange={(e) => setStaffId(e.target.value)}
          fullWidth
          disabled={staffOptions.length <= 1}
        >
          {staffOptions.map((staff) => (
            <MenuItem key={staff.id} value={staff.id}>{staff.name}</MenuItem>
          ))}
        </TextField>
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
        </Stack>
        <TextField
          label="内勤時間"
          type="number"
          value={workHours}
          onChange={(e) => setWorkHours(e.target.value)}
          slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.25' } }}
        />
        <TextField label="メモ" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2} />
      </Stack>
    </AppDialog>
  );
}
