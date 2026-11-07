'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { confirmMcpShiftCancel, getMcpShiftCancelReview } from '@/app/actions/mcpShiftCancelReview';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function readReview(id: string) { return readActionResult(getMcpShiftCancelReview(id)); }
type Review = Awaited<ReturnType<typeof readReview>>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
const syncLabel = (status: string | null) => ({ synced: '同期済み', pending_upsert: '未同期', pending_delete: '削除待ち', failed: '同期失敗' }[status ?? ''] ?? '未確認');
const verb = (operation: 'cancel' | 'soft_delete') => operation === 'cancel' ? '取消' : '論理削除';

function ReviewContent({ id }: { id: string }) {
  const confirm = useConfirm();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ operation: 'cancel' | 'soft_delete'; googleSyncStatus: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void readReview(id).then(value => { if (active) setReview(value); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function execute() {
    if (!review || review.status !== 'confirmation_required' || saving) return;
    setSaving(true);
    try {
      const allowed = await confirm({ title: `シフトを${verb(review.operation)}`, message: `表示されたシフトを${verb(review.operation)}します。よろしいですか？`, confirmText: verb(review.operation), confirmColor: 'error' });
      if (!allowed) return;
      setError(null);
      setResult(await readActionResult(confirmMcpShiftCancel(id)));
    } catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  const identitiesKnown = review?.status === 'confirmation_required' && Boolean(review.references.organization.name && review.references.client.name && review.references.staffs.every(person => person.name));
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AI からのシフト取消・削除案を確認</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : review?.status === 'confirmation_required' ? <>
      <Typography>操作: {verb(review.operation)}</Typography>
      <Typography>事業所: {review.references.organization.name ?? '確認できません'}</Typography>
      <Typography>利用者: {review.references.client.name ?? '確認できません'}</Typography>
      <Typography>シフト名: {review.before.title ?? '未設定'}</Typography>
      <Typography>開始: {dateTime(review.before.start_at)}／終了: {dateTime(review.before.end_at)}（日本時間）</Typography>
      <Typography>担当: {review.references.staffs.length ? review.references.staffs.map(person => person.name ?? '確認できません').join('、') : '未設定'}</Typography>
      <Typography>理由: {review.reason || '指定なし'}</Typography>
      <Typography>関連する記録: {review.before.linked_report_count} 件（記録との関連は保持されます）</Typography>
      <Typography>確認期限: {dateTime(review.expires_at)}（日本時間）</Typography>
      <Alert severity="warning">{review.operation === 'cancel' ? 'シフトを取消状態にします。' : 'シフトを論理削除し、承認済みの保持方針に従って保持します。'} Google カレンダーにも同期します。</Alert>
      {result ? <Alert severity="success">シフトを{verb(result.operation)}しました。Google 同期状態: {syncLabel(result.googleSyncStatus)}。</Alert>
        : !identitiesKnown ? <Alert severity="warning">対象の名前を確認できないため、この案は確定できません。</Alert>
        : <AppButton intent="danger" onClick={() => void execute()} loading={saving}>この内容で{verb(review.operation)}</AppButton>}
    </> : review?.status === 'expired' ? <Alert severity="warning">確認期限が切れました。新しい案を作成してください。</Alert>
      : review?.status === 'changed' ? <Alert severity="warning">対象が変更されました。新しい案を作成してください。</Alert>
      : review?.status === 'updated' ? <Alert severity="success">{verb(review.operation)}済みです。Google 同期状態: {syncLabel(review.google_sync_status)}。</Alert> : null}
    <AppButton component={Link} href="/app" variant="outlined" intent="secondary">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}

export default function McpShiftCancelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReviewContent key={id} id={id} />;
}
