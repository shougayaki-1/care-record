'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Alert, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, DataTable, InnerPageHeader, PageBody, PageLayout } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { approveDeletionRequest, listDeletionRequests, rejectDeletionRequest } from '@/app/actions/deletionRequests';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import { checkManagementPermission } from '@/utils/permissions';
import { buildRecordPath } from '@/utils/recordNavigation';
import type { Database } from '@/types/database.generated';

type Request = Database['public']['Tables']['deletion_requests']['Row'] & { clientId: string | null };
const statusLabels: Record<string, string> = { requested: '確認待ち', approved: '承認済み', completed: '削除完了', rejected: '却下' };

export default function DeletionRequestsClientPage() {
  const { currentOrg } = useWorkspace();
  const params = useSearchParams();
  const requestId = params.get('requestId') || undefined;
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<Request[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [rejecting, setRejecting] = useState<Request | null>(null);
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const locked = useRef(false);
  const orgId = currentOrg?.id;

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    // The selected workspace is external state; discard the previous tenant's rows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setRequests([]);
    setError(null);
    void readActionResult(listDeletionRequests(orgId, 'all', requestId)).then(rows => {
      if (!cancelled) setRequests(rows);
    }).catch(cause => {
      if (!cancelled) setError(getActionErrorMessage(cause, '削除申請を取得できませんでした'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, requestId, refresh]);

  const decide = async (request: Request, decision: 'approve' | 'reject') => {
    if (!orgId || locked.current) return;
    locked.current = true;
    setProcessing(true);
    try {
      if (decision === 'approve' && !await confirm({ title: '削除申請を承認', message: '申請された記録を論理削除します。', confirmText: '承認する', confirmColor: 'error' })) return;
      await readActionResult(decision === 'approve'
        ? approveDeletionRequest(orgId, request.id)
        : rejectDeletionRequest(orgId, request.id, reason));
      showToast(decision === 'approve' ? '削除申請を承認しました' : '削除申請を却下しました');
      setRejecting(null);
      setReason('');
      setRefresh(value => value + 1);
    } catch (cause) {
      showToast(getActionErrorMessage(cause), 'error');
    } finally { locked.current = false; setProcessing(false); }
  };
  const canDecide = Boolean(currentOrg && checkManagementPermission(currentOrg.effectivePermissions, 'reports'));

  return <PageLayout>
    <InnerPageHeader icon={<DeleteOutlineIcon />} title="削除申請" />
    <PageBody>
      <Typography sx={{ mb: 2 }}>本人の申請と、権限のある事業所の申請を確認できます。</Typography>
      {error && <Alert severity="error" action={<AppButton intent="secondary" onClick={() => setRefresh(value => value + 1)}>再試行</AppButton>}>{error}</Alert>}
      <DataTable rows={requests} loading={loading} getRowKey={row => row.id} emptyTitle={requestId ? 'この申請にアクセスできません' : '削除申請はありません'} columns={[
        { key: 'date', header: '申請日時', render: row => new Date(row.requested_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) },
        { key: 'target', header: '対象記録', render: row => row.clientId ? <AppButton intent="secondary" variant="text" href={buildRecordPath(row.clientId, { reportId: row.resource_id })}>記録を確認</AppButton> : '閲覧できる記録はありません' },
        { key: 'status', header: '状態', render: row => statusLabels[row.status] ?? row.status },
        { key: 'reason', header: '申請理由', render: row => <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.reason}</Typography> },
        { key: 'actions', header: '操作', render: row => row.status === 'requested' && canDecide ? <Stack direction="row" spacing={1}>
          <AppButton intent="danger" disabled={processing} onClick={() => void decide(row, 'approve')}>承認</AppButton>
          <AppButton intent="secondary" disabled={processing} onClick={() => { setRejecting(row); setReason(''); }}>却下</AppButton>
        </Stack> : null },
      ]} />
      {!requestId && requests.length === 200 && <Typography>最新の200件を表示しています。</Typography>}
      <AppDialog title="削除申請を却下" open={Boolean(rejecting)} loading={processing} onClose={() => { setRejecting(null); setReason(''); }} actions={<>
        <AppButton intent="secondary" disabled={processing} onClick={() => setRejecting(null)}>キャンセル</AppButton>
        <AppButton intent="warning" loading={processing} disabled={reason.trim().length < 2 || reason.trim().length > 500} onClick={() => { if (rejecting) void decide(rejecting, 'reject'); }}>却下する</AppButton>
      </>}>
        <AppTextField label="却下理由" multiline minRows={3} fullWidth value={reason} onChange={event => setReason(event.target.value)} helperText="2〜500文字で入力してください" />
      </AppDialog>
    </PageBody>
  </PageLayout>;
}
