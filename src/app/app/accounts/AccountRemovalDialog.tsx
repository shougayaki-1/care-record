'use client';
import { Typography, Stack } from '@/components/ui/mui';
import { AppButton, AppDialog } from '@/components/ui';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useToast } from '@/components/ui/ToastProvider';
import { removeAccount } from '@/app/actions/accounts';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import { useAccountOperation } from './useAccountOperation';
import type { AccountProfile } from './types';

type Props = { orgId: string; selectedAccount: AccountProfile; onClose: () => void; onSuccess: () => Promise<void> };
export function AccountRemovalDialog({ orgId, selectedAccount, onClose, onSuccess }: Props) {
  const { showToast } = useToast();
  const { busy, run } = useAccountOperation();
  const executeDelete = () => run(async isCurrent => {
    try {
      await readActionResult(removeAccount(orgId, { targetId: selectedAccount.id, status: selectedAccount.status }));
      if (!isCurrent()) return;
      showToast(selectedAccount.status === 'active' ? 'アカウントを事業所から削除しました' : '招待を取り消しました');
      void onSuccess(); onClose();
    } catch (error) {
      if (isCurrent()) showToast(getActionErrorMessage(error, 'エラーが発生しました'), 'error');
    }
  });
  return (
      <AppDialog open loading={busy} onClose={onClose} maxWidth="xs" title={<Stack direction="row" spacing={1} alignItems="center"><ErrorOutlineIcon color="error" />{selectedAccount?.status === 'active' ? 'アカウントの削除' : '招待の取り消し'}</Stack>} dividers={false} actions={<><AppButton variant="text" intent="secondary" disabled={busy} onClick={onClose}>キャンセル</AppButton><AppButton loading={busy} onClick={executeDelete} intent="danger">{selectedAccount?.status === 'active' ? '削除する' : '取り消す'}</AppButton></>}>
              <Typography variant="body2" paragraph>
                  {selectedAccount?.status === 'active'
                      ? `本当に「${selectedAccount?.name}」さんのアカウントをシステムから削除しますか？\n（※この事業所へのログインができなくなります）`
                      : `「${selectedAccount?.name}」さんへの招待リンクを無効にしますか？`}
              </Typography>
      </AppDialog>

  );
}
