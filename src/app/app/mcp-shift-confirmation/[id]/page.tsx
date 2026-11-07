'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton } from '@/components/ui';
import { getMcpShiftCreateProposal, confirmMcpShiftCreate } from '@/app/actions/mcpShiftCreate';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

type Proposal = Awaited<ReturnType<typeof readProposal>>;
async function readProposal(id: string) { return readActionResult(getMcpShiftCreateProposal(id)); }
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
const syncLabel = (status: string | null) => ({ synced: '同期済み', pending_upsert: '未同期', pending_delete: '削除待ち', failed: '同期失敗' }[status ?? ''] ?? '未確認');

export default function McpShiftConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ shiftId: string; googleSyncStatus: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void readProposal(id).then(value => { if (active) setProposal(value); }).catch(err => { if (active) setError(getActionErrorMessage(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function confirm() {
    setSaving(true); setError(null);
    try { setResult(await readActionResult(confirmMcpShiftCreate(id))); }
    catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  return <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 760 }}><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AIからのシフト作成を確認</Typography>
    <Typography>表示された内容を確認し、登録する場合だけボタンを押してください。勤務予定、移動時間、資格やサービス要件も確認してください。サービス種別は未設定で、登録後に Google カレンダーとの同期を試みます。</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress /> : proposal && <>
      <Box component="dl"><Typography component="dt">事業所</Typography><Typography component="dd">{proposal.organization_name}</Typography>
        <Typography component="dt">利用者</Typography><Typography component="dd">{proposal.client_name}</Typography>
        <Typography component="dt">担当スタッフ</Typography><Typography component="dd">{proposal.staff_name}</Typography>
        <Typography component="dt">開始（日本時間）</Typography><Typography component="dd">{dateTime(proposal.start_at)}</Typography>
        <Typography component="dt">終了（日本時間）</Typography><Typography component="dd">{dateTime(proposal.end_at)}</Typography>
        <Typography component="dt">確認期限</Typography><Typography component="dd">{dateTime(proposal.expires_at)}</Typography></Box>
      {result ? <Alert severity="success">シフトを登録しました。Google同期状態: {syncLabel(result.googleSyncStatus)}。</Alert>
        : proposal.status === 'created' ? <Alert severity="success">この案は登録済みです。AIアプリで同期状態を確認できます。</Alert>
        : proposal.status === 'expired' ? <Alert severity="warning">確認期限が切れています。AIアプリで新しい案を作成してください。</Alert>
        : <AppButton onClick={() => void confirm()} loading={saving}>この内容でシフトを登録</AppButton>}
    </>}
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></Box>;
}
