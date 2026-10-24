'use client';
import { useCallback, useState, useTransition, type SyntheticEvent } from 'react';
import { Box, Alert, CircularProgress, LinearProgress, Tabs, Tab } from '@/components/ui/mui';
import { AppButton, InnerPageHeader, PageBody, PageLayout } from '@/components/ui';
import KeyIcon from '@mui/icons-material/Key';
import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { getAccountOverview, getOrgRoles, getInviteStaffCandidates } from '@/app/actions/accounts';
import { checkManagementPermission } from '@/utils/permissions';
import RoleManagementPanel from '@/components/roles/RoleManagementPanel';
import { useFetchData } from '@/hooks/useFetchData';
import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import { AccountOperations } from './AccountOperations';
import type { AccountsData, AccountProfile } from './types';

const initialAccountsData: AccountsData = { accountList: [], currentUserId: '', availableRoles: [], inviteStaffCandidates: [] };
export default function AccountsPage() {
  const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'accounts' | 'roles'>('accounts');
  const [isPending, startTransition] = useTransition();
  const fetchAccountsData = useCallback(async (): Promise<AccountsData> => {
    if (!currentOrg) return initialAccountsData;
    const [overview, orgRoles, staffCandidates] = await Promise.all([
      readActionResult(getAccountOverview(currentOrg.id)),
      readActionResult(getOrgRoles(currentOrg.id)),
      readActionResult(getInviteStaffCandidates(currentOrg.id)),
    ]);
    // fetchedUserId をローカル変数で保持し sort に使うことで
    // currentUserId state への依存を断ち、二重フェッチループを防ぐ
    const fetchedUserId = overview.currentUserId;
    const mergedList: AccountProfile[] = overview.accounts;

    mergedList.sort((a, b) => {
        if (a.id === fetchedUserId) return -1;
        if (b.id === fetchedUserId) return 1;
        if (a.role === 'owner' && b.role !== 'owner') return -1;
        if (a.role !== 'owner' && b.role === 'owner') return 1;
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return 0;
    });

    return {
      accountList: mergedList,
      currentUserId: fetchedUserId,
      availableRoles: orgRoles,
      inviteStaffCandidates: staffCandidates,
    };
  }, [currentOrg]);

  const {
    data: accountsData,
    error: fetchError,
    loading: isFetching,
    refetch: fetchData,
  } = useFetchData(fetchAccountsData, initialAccountsData, !wsLoading && Boolean(currentOrg), () => {
    showToast('データの取得に失敗しました', 'error');
  }, currentOrg?.id);

  const handleTabChange = (_: SyntheticEvent, value: 'accounts' | 'roles') => startTransition(() => setActiveTab(value));
  if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
  const canManageAccounts = checkManagementPermission(currentOrg.effectivePermissions, 'accounts');
  const canManageRoles = checkManagementPermission(currentOrg.effectivePermissions, 'roles');
  return <PageLayout>
    <InnerPageHeader icon={<KeyIcon />} title="アカウント・権限管理" />
    <PageBody>
      {fetchError != null && <Alert severity="error" action={needsActionRecovery(fetchError) ? <RecoveryLogoutButton /> : <AppButton variant="text" intent="secondary" onClick={() => void fetchData()}>再試行</AppButton>}>{getActionErrorMessage(fetchError)}</Alert>}
      {canManageRoles && <Box sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 0, sm: 1 }, pt: 1 }}>
        {isPending && <LinearProgress />}
        <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
          <Tab label="アカウント" value="accounts" /><Tab label="ロール管理" value="roles" />
        </Tabs>
      </Box>}
      {fetchError == null && <AccountOperations key={`${currentOrg.id}:${accountsData.currentUserId}`} currentOrg={currentOrg} data={accountsData} isFetching={isFetching} canManageAccounts={canManageAccounts} visible={activeTab === 'accounts'} onSuccess={fetchData} refreshWorkspace={refreshWorkspace} />}
      {activeTab === 'roles' && canManageRoles && <RoleManagementPanel embedded onRolesChanged={fetchData} />}
    </PageBody>
  </PageLayout>;
}
