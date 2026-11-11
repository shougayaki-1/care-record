'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { confirmMcpReportTransitionBatch, getMcpReportTransitionBatchReview } from '@/app/actions/mcpReportTransitionBatch';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';
async function readReview(id: string) { return readActionResult(getMcpReportTransitionBatchReview(id)); }
async function confirm(id: string) { return readActionResult(confirmMcpReportTransitionBatch(id)); }
type Review = Awaited<ReturnType<typeof readReview>>;
type Result = Awaited<ReturnType<typeof confirm>>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
function Content({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void readReview(id).then(value => { if (active) setReview(value); }).catch(err => { if (active) setError(getActionErrorMessage(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function save() {
    setSaving(true); setError(null);
    try { setResult(await confirm(id)); } catch (err) { setError(getActionErrorMessage(err)); } finally { setSaving(false); }
  }
  const pending = review?.status === 'confirmation_required' ? review : null;
  const done = result ?? (review?.status === 'completed' ? review : null);
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AIからの一括承認・差戻し案を確認</Typography>
    {error && <Alert severity="error">{error} 処理結果が不明な場合は、案の結果を確認してください。</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : pending ? <>
      <Typography>対象: {pending.count}件。いずれかの対象に問題がある場合は全件を処理しません。</Typography>
      <Typography>確認期限: {dateTime(pending.expires_at)}（日本時間）</Typography>
      {pending.items.map(item => <Box key={item.references.report.id} component="section" sx={{ p: 2 }}>
        <Typography>事業所: {item.references.organization.name} ／ 利用者: {item.references.client.name}</Typography>
        <Typography>記録ID: {item.references.report.id} ／ 記録日: {item.references.report.service_date ?? '未設定'} ／ 版: {item.expected_version}</Typography>
        <Typography>開始: {item.references.report.start_at ? dateTime(item.references.report.start_at) : '未設定'} ／ 終了: {item.references.report.end_at ? dateTime(item.references.report.end_at) : '未設定'}（日本時間）</Typography>
        <Typography>現在の状態: {item.references.report.status === 'approved' ? '承認済み' : item.references.report.status === 'pending' ? '未承認' : '差戻し'} ／ 操作: {item.transition === 'approve' ? '承認' : '差戻し'}</Typography>
        {item.reason && <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>差戻し理由: {item.reason}</Typography>}
        <AppButton component={Link} href={`/app/record/${item.references.client.id}?reportId=${item.references.report.id}`} variant="outlined">対象記録を確認</AppButton>
      </Box>)}
      {done ? <Alert severity="success">{done.count}件を処理しました。</Alert> : <AppButton loading={saving} onClick={() => void save()}>表示した{pending.count}件を確認して処理</AppButton>}
    </> : done ? <Alert severity="success">{done.count}件は処理済みです。</Alert>
      : review?.status === 'expired' || review?.status === 'changed' ? <Alert severity="warning">期限切れまたは対象変更のため全件を処理できません。新しい案を作成してください。</Alert> : null}
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Content key={id} id={id} />; }
