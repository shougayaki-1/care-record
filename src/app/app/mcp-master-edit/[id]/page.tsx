'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { confirmMcpMasterEdit, getMcpMasterEditReview } from '@/app/actions/mcpMasterEdit';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function readReview(id: string) { return readActionResult(getMcpMasterEditReview(id)); }
type Review = Awaited<ReturnType<typeof readReview>>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));

function ReviewContent({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    let active = true;
    void readReview(id).then(value => { if (active) setReview(value); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function confirm() {
    setSaving(true); setError(null);
    try { await readActionResult(confirmMcpMasterEdit(id)); setUpdated(true); }
    catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AI からのマスタ変更案を確認</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : review?.status === 'confirmation_required' ? <>
      <Typography>事業所: {review.organization_name}</Typography>
      <Typography>対象: {review.kind === 'client' ? '利用者' : 'スタッフ'}（ID: {review.target_id}）</Typography>
      <Typography>変更前の名前: {review.before.name}</Typography>
      <Typography>変更後の名前: {review.proposal.name}</Typography>
      {review.kind === 'staff' && <>
        <Typography>変更前の雇用形態: {review.before.employment_type ?? '未設定'}／勤務形態: {review.before.work_style ?? '未設定'}</Typography>
        <Typography>変更後の雇用形態: {review.proposal.employment_type ?? '未設定'}／勤務形態: {review.proposal.work_style ?? '未設定'}</Typography>
      </>}
      <Typography>確認期限: {dateTime(review.expires_at)}（日本時間）</Typography>
      {updated ? <Alert severity="success">マスタを変更しました。</Alert> : <AppButton onClick={() => void confirm()} loading={saving}>この内容でマスタを変更</AppButton>}
    </> : review?.status === 'updated' ? <Alert severity="success">変更済みです。</Alert>
      : review?.status === 'expired' ? <Alert severity="warning">確認期限が切れました。新しい案を作成してください。</Alert>
      : review?.status === 'changed' ? <Alert severity="warning">対象が変更されました。新しい案を作成してください。</Alert> : null}
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}
export default function McpMasterEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReviewContent key={id} id={id} />;
}
