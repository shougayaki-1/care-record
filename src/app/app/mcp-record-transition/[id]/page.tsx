'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { confirmMcpReportTransition, getMcpReportTransitionReview } from '@/app/actions/mcpReportTransition';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function readReview(id: string) { return readActionResult(getMcpReportTransitionReview(id)); }
async function confirm(id: string) { return readActionResult(confirmMcpReportTransition(id)); }
type Review = Awaited<ReturnType<typeof readReview>>;
type Result = Awaited<ReturnType<typeof confirm>>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));

function ReviewContent({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void readReview(id).then(value => { if (active) setReview(value); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function save() {
    setSaving(true); setError(null);
    try { setResult(await confirm(id)); }
    catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  const details = review?.status === 'confirmation_required' ? review : null;
  const completed = result ?? (review?.status === 'approved' || review?.status === 'remanded' ? review : null);
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AIからの承認・差戻し案を確認</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : details ? <>
      <Typography>事業所: {details.references.organization.name}</Typography>
      <Typography>利用者: {details.references.client.name}</Typography>
      <Typography>対象: 1件 ／ 記録ID: {details.references.report.id}</Typography>
      <Typography>記録日: {details.references.report.service_date ?? '未設定'} ／ 版: {details.expected_version}</Typography>
      <Typography>開始: {details.references.report.start_at ? dateTime(details.references.report.start_at) : '未設定'} ／ 終了: {details.references.report.end_at ? dateTime(details.references.report.end_at) : '未設定'}（日本時間）</Typography>
      <Typography>現在の状態: {details.references.report.status === 'approved' ? '承認済み' : details.references.report.status === 'pending' ? '未承認' : '差戻し'}</Typography>
      <Typography>操作: {details.transition === 'approve' ? '承認' : '差戻し'}</Typography>
      {details.reason && <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>差戻し理由: {details.reason}</Typography>}
      <Typography>確認期限: {dateTime(details.expires_at)}（日本時間）</Typography>
      <AppButton component={Link} href={`/app/record/${details.references.client.id}?reportId=${details.references.report.id}`} variant="outlined">対象記録を確認</AppButton>
      {completed ? <Alert severity="success">{completed.status === 'approved' ? '記録を承認しました。' : '記録を差戻しました。'}</Alert>
        : <AppButton loading={saving} onClick={() => void save()}>{details.transition === 'approve' ? 'この記録を承認' : 'この記録を差戻し'}</AppButton>}
    </> : completed ? <Alert severity="success">{completed.status === 'approved' ? '記録は承認済みです。' : '記録は差戻し済みです。'}</Alert>
      : review?.status === 'expired' ? <Alert severity="warning">確認期限が切れました。新しい案を作成してください。</Alert>
      : review?.status === 'changed' ? <Alert severity="warning">対象が変更されました。新しい案を作成してください。</Alert> : null}
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}

export default function McpRecordTransitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReviewContent key={id} id={id} />;
}
