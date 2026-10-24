'use client';
import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Box, Typography } from '@/components/ui/mui';
import { AppButton, PageToolbar } from '@/components/ui';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useToast } from '@/components/ui/ToastProvider';
import type { Workspace } from '@/context/WorkspaceContext';
import type { AccountsData, AccountProfile } from './types';
import { AccountList } from './AccountList';
import { InvitationDialog } from './InvitationDialog';
import { MemberRoleDialog } from './MemberRoleDialog';
import { AccountRemovalDialog } from './AccountRemovalDialog';
import { useOwnerAddFlow } from './useOwnerAddFlow';

type Props = { currentOrg: Workspace; data: AccountsData; isFetching: boolean; canManageAccounts: boolean; visible: boolean; onSuccess: () => Promise<void>; refreshWorkspace: () => Promise<void> };
export function AccountOperations({ currentOrg, data, isFetching, canManageAccounts, visible, onSuccess, refreshWorkspace }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { showToast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<AccountProfile | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AccountProfile | null>(null);
  const { openOwnerAdd, ownerAddDialog } = useOwnerAddFlow({ currentOrg, ...data, isFetching, fetchData: onSuccess, refreshWorkspace });
  const isOwner = currentOrg.role === 'owner';
  const openRemoval = (account: AccountProfile) => {
    if (account.id === data.currentUserId && account.role === 'owner' && data.accountList.filter(a => a.role === 'owner' && a.status === 'active').length <= 1) {
      showToast('あなたは最後のオーナーのため削除（脱退）できません。', 'error'); return;
    }
    setRemoveTarget(account);
  };
  const copyInvitation = async (code: string) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/join?code=${code}`); showToast('招待リンクをコピーしました'); }
    catch { showToast('リンクのコピーに失敗しました', 'error'); }
  };
  return <>
    {visible && <>
      <PageToolbar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight="bold" color="text.primary">システムログインアカウント</Typography>
          <Typography variant="caption" color="text.secondary">アプリにログインできるユーザーと、その権限を管理します。</Typography>
        </Box>
        {canManageAccounts && <AppButton startIcon={<PersonAddIcon />} onClick={() => setInviteOpen(true)} sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}>新しい人を招待</AppButton>}
      </PageToolbar>
      <AccountList {...data} isMobile={isMobile} isFetching={isFetching} canManageAccounts={canManageAccounts} isOwner={isOwner} onEditRoles={setRoleTarget} onRemove={openRemoval} onAddOwner={openOwnerAdd} onCopyInvitation={copyInvitation} />
    </>}
    {inviteOpen && <InvitationDialog currentOrg={currentOrg} availableRoles={data.availableRoles} inviteStaffCandidates={data.inviteStaffCandidates} onClose={() => setInviteOpen(false)} onSuccess={onSuccess} />}
    {roleTarget && <MemberRoleDialog key={roleTarget.id} orgId={currentOrg.id} selectedAccount={roleTarget} currentUserId={data.currentUserId} availableRoles={data.availableRoles} isOwner={isOwner} onClose={() => setRoleTarget(null)} onSuccess={onSuccess} />}
    {removeTarget && <AccountRemovalDialog key={removeTarget.id} orgId={currentOrg.id} selectedAccount={removeTarget} onClose={() => setRemoveTarget(null)} onSuccess={onSuccess} />}
    {ownerAddDialog}
  </>;
}
