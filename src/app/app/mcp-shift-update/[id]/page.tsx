'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { confirmMcpShiftUpdate, getMcpShiftUpdateReview } from '@/app/actions/mcpShiftUpdateReview';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function readReview(id: string) { return readActionResult(getMcpShiftUpdateReview(id)); }
type Review = Awaited<ReturnType<typeof readReview>>;
type Pending = Extract<Review, { status: 'confirmation_required' }>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
const syncLabel = (status: string | null) => ({ synced: '同期済み', pending_upsert: '未同期', pending_delete: '削除待ち', failed: '同期失敗' }[status ?? ''] ?? '未確認');

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

function ReviewContent({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ shiftId: string; googleSyncStatus: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void readReview(id).then(value => { if (active) setReview(value); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function confirm() {
    setSaving(true);
    setError(null);
    try { setResult(await readActionResult(confirmMcpShiftUpdate(id))); }
    catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  const identitiesKnown = review?.status === 'confirmation_required' && (() => {
    const refs = review.references;
    const known = (items: Array<{ id: string; name: string | null }>, value: string) =>
      items.some(item => item.id === value && Boolean(item.name));
    const segments = [...review.before.segments, ...review.proposal.segments];
    return Boolean(refs.organization.name && refs.client.name)
      && review.before.staffs.every(item => known(refs.staffs, item.staff_id))
      && segments.every(segment => (!segment.service_type_id || known(refs.service_types, segment.service_type_id))
        && segment.staffs.every(staff => known(refs.staffs, staff.staff_id)
          && (!staff.staff_role_id || known(refs.staff_roles, staff.staff_role_id))));
  })();
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AI からのシフト変更案を確認</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : review?.status === 'confirmation_required' ? <>
      <Typography>事業所: {review.references.organization.name ?? '確認できません'}</Typography>
      <Typography>利用者: {review.references.client.name ?? '確認できません'}</Typography>
      <Typography>変更前のシフト名: {review.before.title ?? '未設定'}</Typography>
      <ShiftDetails title="変更前" start={review.before.start_at} end={review.before.end_at} segments={review.before.segments} references={review.references} />
      {review.before.staffs.length > 0 && <Typography>変更前の担当: {review.before.staffs.map(item => review.references.staffs.find(person => person.id === item.staff_id)?.name ?? '確認できません').join('、')}</Typography>}
      <ShiftDetails title="変更後" start={review.proposal.start_at} end={review.proposal.end_at} segments={review.proposal.segments} references={review.references} />
      {review.before.segments.some(segment => segment.source_pattern_segment_id) && <Alert severity="warning">変更すると、サービス区間と元のパターンとの関連は解除されます。</Alert>}
      <Typography>確認期限: {dateTime(review.expires_at)}（日本時間）</Typography>
      <Typography>勤務予定、移動時間、資格、サービス要件と他の担当者への影響を確認してください。変更後のシフト名は利用者と担当者の名前から更新され、Google カレンダーとの同期が必要です。</Typography>
      {result ? <Alert severity="success">シフトを変更しました。Google 同期状態: {syncLabel(result.googleSyncStatus)}。</Alert>
        : !identitiesKnown ? <Alert severity="warning">対象の名前を確認できないため、この案は確定できません。新しい案を作成してください。</Alert>
        : <AppButton onClick={() => void confirm()} loading={saving}>この内容でシフトを変更</AppButton>}
    </> : review?.status === 'expired' ? <Alert severity="warning">確認期限が切れました。新しい案を作成してください。</Alert>
      : review?.status === 'changed' ? <Alert severity="warning">対象が変更されました。新しい案を作成してください。</Alert>
      : review?.status === 'updated' ? <Alert severity="success">変更済みです。Google 同期状態: {syncLabel(review.google_sync_status)}。</Alert> : null}
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}

export default function McpShiftUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReviewContent key={id} id={id} />;
}
