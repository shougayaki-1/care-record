'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { listMcpRecordCorrectionProposals } from '@/app/actions/mcpRecordEditReview';
import { useWorkspace } from '@/context/WorkspaceContext';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function load(org: string, offset: number) { return readActionResult(listMcpRecordCorrectionProposals(org, offset)); }
type Page = Awaited<ReturnType<typeof load>>;
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function CorrectionList({ organizationId }: { organizationId: string }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void load(organizationId, offset).then(value => { if (active) { setPage(value); setError(null); } })
      .catch(err => { if (active) { setPage(null); setError(getActionErrorMessage(err)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, offset]);
  function move(next: number) { setLoading(true); setPage(null); setOffset(next); }
  return <Stack spacing={2}>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : page && (page.proposals.length ? page.proposals.map(item => <Stack key={item.id} spacing={1}>
      <Typography>利用者: {item.client_name} ／ 確認日時: {dateTime(item.confirmed_at)}（日本時間）</Typography>
      <Typography>元の記録 ID: {item.report_id} ／ 元の版: {item.base_version}</Typography>
      <AppButton component={Link} href={`/app/mcp-record-edit/${item.id}`} variant="outlined">訂正案を確認</AppButton>
    </Stack>) : <Typography>保存した訂正案はありません。</Typography>)}
    <Stack direction="row" spacing={1}>
      <AppButton variant="outlined" disabled={loading || offset === 0} onClick={() => move(Math.max(0, offset - 20))}>前へ</AppButton>
      <AppButton variant="outlined" disabled={loading || !page?.has_more} onClick={() => move(offset + 20)}>次へ</AppButton>
    </Stack>
  </Stack>;
}

export default function McpRecordCorrectionsPage() {
  const { currentOrg, loading } = useWorkspace();
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">保存した記録の訂正案</Typography>
    <Typography>本人が確認して保存した訂正案です。承認済みの記録は変更されていません。</Typography>
    {loading ? <CircularProgress aria-label="読み込み中" /> : currentOrg ? <CorrectionList key={currentOrg.id} organizationId={currentOrg.id} /> : <Alert severity="warning">事業所を選択してください。</Alert>}
    <AppButton component={Link} href="/app" variant="outlined">ホームへ戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}
