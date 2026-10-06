'use client';

import { commitRecordChange } from '@/utils/recordFeedUpdates';
import { useMemo, useRef, useState } from 'react';
import { Alert, Stack, Typography } from '@/components/ui/mui';
import SaveIcon from '@mui/icons-material/Save';
import { AppButton, AppTextField, DateTimeField, NumberField, RecordFormDialog, SectionCard, SelectField, UnitAdornment } from '@/components/ui';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useAsyncRecordAction } from '@/hooks/useAsyncRecordAction';
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
  const { pending: saving, error, run, isRunning, attemptKey, finishAttempt } = useAsyncRecordAction(organizationId);
  const confirm = useConfirm();
  const [attempted, setAttempted] = useState(false);
  const now = useMemo(() => new Date(), []);
  const initialDates = useRef({ start: formatDatetimeLocal(now), end: formatDatetimeLocal(new Date(now.getTime() + 60 * 60 * 1000)) });
  const [title, setTitle] = useState('会議');
  const [workType, setWorkType] = useState('meeting');
  const [staffId, setStaffId] = useState('');
  const [startAt, setStartAt] = useState(() => formatDatetimeLocal(now));
  const [endAt, setEndAt] = useState(() => formatDatetimeLocal(new Date(now.getTime() + 60 * 60 * 1000)));
  const [workHours, setWorkHours] = useState('1');
  const [note, setNote] = useState('');

  const validDates = Number.isFinite(new Date(startAt).getTime()) && Number.isFinite(new Date(endAt).getTime()) && new Date(endAt) > new Date(startAt);
  const errors = {
    title: !title.trim() || title.trim().length > 100 ? '件名を1〜100文字で入力してください' : '',
    dates: validDates ? '' : '終了日時は開始日時より後にしてください',
    hours: !workHours.trim() || !Number.isFinite(Number(workHours)) || Number(workHours) <= 0 || Number(workHours) > 24 ? '内勤時間を0より大きく24以下で入力してください' : '',
    staff: staffOptions.length === 0 ? '対象スタッフを選択してください' : '',
  };
  const changeInput = (setValue: (value: string) => void, value: string) => {
    finishAttempt(`internal-work:${organizationId}`);
    setValue(value);
  };
  const resetForm = () => {
    finishAttempt(`internal-work:${organizationId}`);
    const next = new Date();
    initialDates.current = { start: formatDatetimeLocal(next), end: formatDatetimeLocal(new Date(next.getTime() + 60 * 60 * 1000)) };
    setTitle('会議'); setWorkType('meeting'); setStaffId(''); setWorkHours('1'); setNote('');
    setStartAt(initialDates.current.start); setEndAt(initialDates.current.end);
    setAttempted(false);
  };
  const handleClose = async () => {
    if (isRunning()) return;
    const changed = title !== '会議' || workType !== 'meeting' || staffId !== '' || note !== '' || workHours !== '1' || startAt !== initialDates.current.start || endAt !== initialDates.current.end;
    if (changed) {
      const outcome = await run(async () => {}, {
        confirm: () => confirm({ title: '保存されていない変更があります', message: '入力内容が保存されていません。保存せず閉じますか？', confirmText: '保存せず閉じる', confirmColor: 'warning' }),
        errorMessage: '画面を閉じられませんでした。入力内容は保持しています。',
      });
      if (!outcome.ok) return;
    }
    resetForm();
    onClose();
  };

  const handleSave = async () => {
    setAttempted(true);
    if (Object.values(errors).some(Boolean)) return;
    const result = await run(async (isCurrent) => {
      const payload = {
        organizationId,
        staffId: staffId || staffOptions[0]?.id || null,
        title,
        workType,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        workHours: Number(workHours),
        note,
      };
      const idempotencyKey = attemptKey(`internal-work:${organizationId}`, payload);
      await commitRecordChange(organizationId, () => saveInternalWork({ ...payload, idempotencyKey }));
      if (isCurrent()) {
        try { await onSaved?.(); } catch (error) { console.error('Saved internal work callback failed', error); }
      }
    }, { successMessage: '内勤実績を保存しました', errorMessage: '保存に失敗しました。入力内容は保持しています。もう一度保存してください。' });
    if (!result.ok) return;
    // A subsequent entry starts clean; failures keep every field for retry.
    resetForm();
    onClose();
  };

  return (
    <RecordFormDialog
      open={open}
      onClose={() => void handleClose()}
      title="内勤を記録"
      loading={saving}
      actions={<>
        <AppButton intent="secondary" variant="text" size="small" onClick={() => void handleClose()} disabled={saving}>キャンセル</AppButton>
        <AppButton size="small" startIcon={<SaveIcon />} onClick={handleSave} loading={saving} disabled={staffOptions.length === 0}>保存</AppButton>
      </>}
    >
      {error && <Alert severity="error">{error}</Alert>}
      <SectionCard>
        <Typography component="h3" variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>基本情報</Typography>
        <Stack spacing={3}>
          <SelectField required label="担当スタッフ" options={staffOptions.map((staff) => ({ value: staff.id, label: staff.name }))} value={staffId || staffOptions[0]?.id || ''} onChange={(value) => changeInput(setStaffId, value)} disabled={saving || staffOptions.length <= 1} error={attempted && Boolean(errors.staff)} helperText={attempted ? errors.staff : undefined} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <AppTextField required label="件名" value={title} onChange={(event) => changeInput(setTitle, event.target.value)} disabled={saving} error={attempted && Boolean(errors.title)} helperText={attempted ? errors.title : undefined} />
            <SelectField label="種別" value={workType} onChange={(value) => changeInput(setWorkType, value)} options={WORK_TYPES} disabled={saving} />
          </Stack>
        </Stack>
      </SectionCard>
      <SectionCard>
        <Typography component="h3" variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>勤務日時・時間</Typography>
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <DateTimeField required label="開始日時" value={startAt} onChange={(event) => changeInput(setStartAt, event.target.value)} disabled={saving} error={attempted && Boolean(errors.dates)} />
            <DateTimeField required label="終了日時" value={endAt} onChange={(event) => changeInput(setEndAt, event.target.value)} disabled={saving} error={attempted && Boolean(errors.dates)} helperText={attempted ? errors.dates : undefined} />
          </Stack>
          <NumberField required label="内勤時間" value={workHours} onChange={(event) => changeInput(setWorkHours, event.target.value)} disabled={saving} error={attempted && Boolean(errors.hours)} helperText={attempted ? errors.hours : undefined} slotProps={{ input: { endAdornment: <UnitAdornment>時間</UnitAdornment> }, htmlInput: { min: 0, max: 24, step: '0.25' } }} />
        </Stack>
      </SectionCard>
      <SectionCard>
        <AppTextField label="メモ" value={note} onChange={(event) => changeInput(setNote, event.target.value)} disabled={saving} multiline minRows={2} />
      </SectionCard>
    </RecordFormDialog>
  );
}
