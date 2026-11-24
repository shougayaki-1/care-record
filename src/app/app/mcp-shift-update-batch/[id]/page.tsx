'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, CheckboxGroupField, PageBody, PageLayout } from '@/components/ui';
import { confirmMcpShiftUpdateBatch, getMcpShiftUpdateBatch } from '@/app/actions/mcpShiftUpdateBatch';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function readBatch(id: string) { return readActionResult(getMcpShiftUpdateBatch(id)); }
type Batch = Awaited<ReturnType<typeof readBatch>>;
type Pending = Extract<Batch['items'][number]['review'], { status: 'confirmation_required' }>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));

function ShiftDetails({ title, start, end, segments, references }: {
  title: string; start: string; end: string;
  segments: Array<{ start_at: string; end_at: string; service_type_id?: string | null; staffs: Array<{ staff_id: string; staff_role_id?: string | null }> }>;
  references: Pending['references'];
}) {
  const nameOf = (items: Array<{ id: string; name: string | null }>, value?: string | null) =>
    value ? items.find(item => item.id === value)?.name ?? '確認できません' : '未設定';
  return <Box component="section" aria-label={title}>
    <Typography variant="h6">{title}</Typography>
    <Typography>開始: {dateTime(start)}／終了: {dateTime(end)}（日本時間）</Typography>
    {segments.length === 0 ? <Typography>サービス区間はありません。</Typography> : segments.map((segment, index) =>
      <Box key={index} component="section" sx={{ mt: 1 }} aria-label={`${title}の区間 ${index + 1}`}>
        <Typography>区間 {index + 1}: {dateTime(segment.start_at)} ～ {dateTime(segment.end_at)}</Typography>
        <Typography>サービス: {nameOf(references.service_types, segment.service_type_id)}</Typography>
        {segment.staffs.length === 0 ? <Typography>担当者なし</Typography> : segment.staffs.map((staff, staffIndex) =>
          <Typography key={staffIndex}>担当: {nameOf(references.staffs, staff.staff_id)}（役割: {nameOf(references.staff_roles, staff.staff_role_id)}）</Typography>)}
      </Box>)}
  </Box>;
}

function identitiesKnown(review: Pending) {
  const refs = review.references;
  const known = (items: Array<{ id: string; name: string | null }>, value: string) =>
    items.some(item => item.id === value && Boolean(item.name));
  return Boolean(refs.organization.name && refs.client.name)
    && review.before.staffs.every(item => known(refs.staffs, item.staff_id))
    && [...review.before.segments, ...review.proposal.segments].every(segment =>
      (!segment.service_type_id || known(refs.service_types, segment.service_type_id))
      && segment.staffs.every(staff => known(refs.staffs, staff.staff_id)
        && (!staff.staff_role_id || known(refs.staff_roles, staff.staff_role_id))));
}

function BatchReview({ id }: { id: string }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Array<{ proposalId: string; status: string }>>([]);
  useEffect(() => {
    let active = true;
    void readBatch(id).then(value => { if (active) setBatch(value); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function confirm() {
    setSaving(true); setError(null);
    try {
      const value = await readActionResult(confirmMcpShiftUpdateBatch(id, selected));
      setResults(value); setSelected([]); setBatch(await readBatch(id));
    } catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  const statusLabel: Record<string, string> = { updated: '変更済み', shift_conflict: '予定が重複しています', proposal_changed: '対象が変更されました', proposal_expired: '確認期限が切れました' };
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AI からの複数シフト変更案を確認</Typography>
    <Typography>内容を照合し、変更する案だけを選択してください。選択しない案は変更されません。</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {results.length > 0 && <Alert severity={results.some(result => result.status !== 'updated') ? 'warning' : 'success'}>変更 {results.filter(result => result.status === 'updated').length} 件、失敗 {results.filter(result => result.status !== 'updated').length} 件。</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : batch?.items.map(item => {
      const review = item.review;
      const outcome = results.find(result => result.proposalId === item.proposal_id);
      return <Box key={item.proposal_id} component="section" aria-label={`変更案 ${item.position}`} sx={{ border: 1, borderColor: 'divider', p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="h6">変更案 {item.position}</Typography>
          {outcome && <Alert severity={outcome.status === 'updated' ? 'success' : 'warning'}>{statusLabel[outcome.status]}</Alert>}
          {review.status === 'confirmation_required' ? <>
            <Typography>事業所: {review.references.organization.name ?? '確認できません'}／利用者: {review.references.client.name ?? '確認できません'}</Typography>
            <Typography>変更前のシフト名: {review.before.title ?? '未設定'}</Typography>
            <ShiftDetails title="変更前" start={review.before.start_at} end={review.before.end_at} segments={review.before.segments} references={review.references} />
            {review.before.staffs.length > 0 && <Typography>変更前の担当: {review.before.staffs.map(staff => review.references.staffs.find(person => person.id === staff.staff_id)?.name ?? '確認できません').join('、')}</Typography>}
            <ShiftDetails title="変更後" start={review.proposal.start_at} end={review.proposal.end_at} segments={review.proposal.segments} references={review.references} />
            {review.before.segments.some(segment => segment.source_pattern_segment_id) && <Alert severity="warning">変更すると元のパターンとの関連は解除されます。</Alert>}
            {item.has_overlap && <Alert severity="warning">案の作成時に担当者の重複が見つかりました。確定時にも再確認します。</Alert>}
            {item.has_unassigned && <Alert severity="warning">利用者の担当として登録されていないスタッフが含まれます。</Alert>}
            <Typography>確認期限: {dateTime(review.expires_at)}（日本時間）</Typography>
            {identitiesKnown(review) ? <CheckboxGroupField label={`変更案 ${item.position} の選択`} options={[item.proposal_id]} value={selected} onChange={setSelected} getOptionLabel={() => 'この案を変更する'} getOptionValue={value => value} />
              : <Alert severity="warning">対象の名前を確認できないため、この案は確定できません。</Alert>}
          </> : <Alert severity={review.status === 'updated' ? 'success' : 'warning'}>{review.status === 'updated' ? '変更済みです。' : review.status === 'expired' ? '確認期限が切れました。' : '対象が変更されました。'}</Alert>}
        </Stack>
      </Box>;
    })}
    <Typography>勤務予定、移動時間、資格、サービス要件と他の担当者への影響を確認してください。変更後は Google カレンダーとの同期が必要です。</Typography>
    <AppButton onClick={() => void confirm()} disabled={selected.length === 0} loading={saving}>選択した {selected.length} 件を変更</AppButton>
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}
export default function McpShiftUpdateBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BatchReview key={id} id={id} />;
}
