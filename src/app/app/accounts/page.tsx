'use client';

import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';
import { useId, useState, useCallback, useTransition, useEffect, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, Stack, Alert,
  IconButton, MenuItem, Menu, ListItemIcon,
  CircularProgress, Divider, LinearProgress, Tabs, Tab,
} from '@/components/ui/mui';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import ShareIcon from '@mui/icons-material/Share';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SyncAltIcon from '@mui/icons-material/SyncAlt'; 
import KeyIcon from '@mui/icons-material/Key';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { createInvitation, getAccountOverview, getInviteStaffCandidates, getOrgRoles, updateMemberRoles, removeAccount, type InviteStaffCandidate } from '@/app/actions/accounts';
import { AppButton, AppDialog, AppTextField, SelectField, StatusChip, EmptyState, InnerPageHeader, PageBody, PageLayout, PageToolbar } from '@/components/ui';
import { checkManagementPermission } from '@/utils/permissions';
import RoleManagementPanel from '@/components/roles/RoleManagementPanel';
import { useFetchData } from '@/hooks/useFetchData';
import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import { useReauth } from '@/hooks/useReauth';
import { takeProviderReauthGrant } from '@/app/actions/authSecurity';
import { addOrganizationOwner } from '@/app/actions/organizationOwners';
import { readOwnerAddResume, OWNER_ADD_RESUME_KEY } from '@/utils/ownerAddResume';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

type AccountProfile = {
    id: string;
    name: string;
    email?: string;
    role: string;
    roles: { id: string; name: string; color: string | null }[];
    status: 'active' | 'invited';
    invitation_code?: string;
    staffId?: string | null;
    staffName?: string | null;
};
type OrgRoleOption = { id: string; name: string; color: string | null; is_preset: boolean; is_dangerous: boolean };
type AccountsData = {
  accountList: AccountProfile[];
  currentUserId: string;
  availableRoles: OrgRoleOption[];
  inviteStaffCandidates: InviteStaffCandidate[];
};
const initialAccountsData: AccountsData = {
  accountList: [],
  currentUserId: '',
  availableRoles: [],
  inviteStaffCandidates: [],
};

export default function AccountsPage() {
  const roleRestrictionId = useId();
  const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
  const { showToast } = useToast();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [isPending, startTransition] = useTransition();
  
  const [activeTab, setActiveTab] = useState<'accounts' | 'roles'>('accounts');
  
  // 新規招待用
  const [openInvite, setOpenInvite] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [selectedInviteStaffId, setSelectedInviteStaffId] = useState('none');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  // 操作メニュー用
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountProfile | null>(null);

  // ダイアログ用
  const [openRoleDialog, setOpenRoleDialog] = useState(false);
  const [editOrgRoleIds, setEditOrgRoleIds] = useState<string[]>([]);
  
  // ★追加：削除（取り消し）確認ダイアログ用
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const { requestReauth, reauthDialog } = useReauth();
  const [ownerTarget, setOwnerTarget] = useState<{ orgId: string; id: string; name: string; token?: string } | null>(null);
  const [ownerAdding, setOwnerAdding] = useState(false);
  const ownerBusy = useRef(false);
  const resumeHandled = useRef(false);
  const orgRef = useRef(currentOrg);
  useEffect(() => { orgRef.current = currentOrg; }, [currentOrg]);

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
  const { accountList, currentUserId, availableRoles, inviteStaffCandidates } = accountsData;

  useEffect(() => {
    if (!currentOrg || isFetching || !currentUserId || resumeHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'owner_add') return;
    resumeHandled.current = true;
    const pending = readOwnerAddResume(params, sessionStorage.getItem(OWNER_ADD_RESUME_KEY), currentOrg.id, currentUserId);
    const target = pending && accountList.find(account => account.id === pending.targetId && account.status === 'active' && account.role === 'member');
    window.history.replaceState(null, '', '/app/accounts');
    sessionStorage.removeItem(OWNER_ADD_RESUME_KEY);
    void (async () => {
      const grant = await readActionResult(takeProviderReauthGrant('owner_add'));
      if (!pending || !target || currentOrg.role !== 'owner' || !grant || params.has('stepupError')) {
        showToast('再認証または追加対象を確認できません。もう一度オーナー追加を開始してください。', 'error');
        return;
      }
      // SSO復帰だけで昇格しない。再検証した対象を確認画面へ戻す。
      setOwnerTarget({ orgId: pending.orgId, id: target.id, name: target.name, token: grant.token });
    })().catch(() => showToast('再認証を確認できません。もう一度お試しください。', 'error'));
  }, [currentOrg, currentUserId, accountList, isFetching, showToast]);

  const executeOwnerAdd = async () => {
    if (!ownerTarget || !currentOrg || currentOrg.role !== 'owner' || currentOrg.id !== ownerTarget.orgId || ownerBusy.current) return;
    const target = ownerTarget;
    ownerBusy.current = true;
    setOwnerAdding(true);
    try {
      sessionStorage.setItem(OWNER_ADD_RESUME_KEY, JSON.stringify({ orgId: target.orgId, targetId: target.id, actorId: currentUserId }));
      const grant = target.token ? { token: target.token } : await requestReauth('owner_add', {
        next: `/app/accounts?stepup=1&action=owner_add&reauthOrg=${target.orgId}&target=${target.id}`,
      });
      if (!grant) return;
      if (orgRef.current?.id !== target.orgId || orgRef.current.role !== 'owner') {
        throw new Error('事業所が変更されています。もう一度追加対象を選んでください。');
      }
      await readActionResult(addOrganizationOwner(target.orgId, target.id, grant.token));
      sessionStorage.removeItem(OWNER_ADD_RESUME_KEY);
      setOwnerTarget(null);
      showToast('オーナーを追加しました。現在のオーナーも引き続きオーナーです。');
      await fetchData();
      await refreshWorkspace();
    } catch (error) {
      // 使用済み・期限切れのSSO証明を次の試行に持ち越さない。
      setOwnerTarget({ orgId: target.orgId, id: target.id, name: target.name });
      showToast(getActionErrorMessage(error, 'オーナーの追加に失敗しました'), 'error');
    } finally {
      ownerBusy.current = false;
      setOwnerAdding(false);
    }
  };


  const handleTabChange = useCallback((_: SyntheticEvent, value: 'accounts' | 'roles') => {
    startTransition(() => setActiveTab(value));
  }, [startTransition]);

  const handleGenerateLink = async () => {
    if (!currentOrg) return;
    try {
        const { code } = await readActionResult(createInvitation(currentOrg.id, {
          targetName: newInviteName,
          email: newInviteEmail,
          roleIds: selectedRoleIds,
          staffId: selectedInviteStaffId === 'none' ? null : selectedInviteStaffId,
        }));
        setGeneratedLink(`${BASE_URL}/join?code=${code}`);
        fetchData();
    } catch (e) {
        console.error(e);
        showToast(getActionErrorMessage(e, '招待の発行に失敗しました'), 'error');
    }
  };

  const handleShare = async () => {
      if (navigator.share) {
          try { await navigator.share({ title: 'CareRecordへの招待', text: `${currentOrg?.name}への招待が届いています。`, url: generatedLink }); } catch (e) { console.error(e); }
      } else { 
          navigator.clipboard.writeText(generatedLink); 
          showToast('リンクをコピーしました'); 
      }
  };

  const copyInvitationLink = (code: string) => {
      const url = `${BASE_URL}/join?code=${code}`;
      navigator.clipboard.writeText(url);
      showToast('招待リンクをコピーしました');
      handleMenuClose();
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, account: AccountProfile) => {
      setMenuAnchor(event.currentTarget);
      setSelectedAccount(account);
  };
  const handleMenuClose = () => { 
      setMenuAnchor(null); 
  };

  const openRoleEditDialog = () => {
    if (!selectedAccount) return;
    setEditOrgRoleIds(selectedAccount.roles?.map(r => r.id) ?? []);
    setOpenRoleDialog(true);
    handleMenuClose();
  };

  const executeRoleChange = async () => {
    if (!currentOrg || !selectedAccount) return;
    try {
      if (selectedAccount.status === 'active') {
        await readActionResult(updateMemberRoles(currentOrg.id, selectedAccount.id, editOrgRoleIds));
      }

      showToast('権限を変更しました');
      setOpenRoleDialog(false);
      fetchData();

      if (selectedAccount.id === currentUserId) {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error) {
      console.error(error);
      showToast('変更に失敗しました', 'error');
    }
  };

  // ★修正：削除（取り消し）メニューをクリックした際の処理（ダイアログを開くだけ）
  const openDeleteConfirmDialog = () => {
      if (!selectedAccount) return;
      
      // 最後のオーナー保護
      if (selectedAccount.id === currentUserId && selectedAccount.role === 'owner') {
          const ownerCount = accountList.filter(a => a.role === 'owner' && a.status === 'active').length;
          if (ownerCount <= 1) {
              showToast('あなたは最後のオーナーのため削除（脱退）できません。', 'error');
              handleMenuClose();
              return;
          }
      }
      
      setOpenDeleteDialog(true);
      handleMenuClose();
  };

  // ★追加：ダイアログで「削除（取り消し）」を押した時の実際のDB処理
  const executeDelete = async () => {
      if (!currentOrg || !selectedAccount) return;

      try {
          await readActionResult(removeAccount(currentOrg.id, {
              targetId: selectedAccount.id,
              status: selectedAccount.status === 'active' ? 'active' : 'invited',
          }));
          showToast(selectedAccount.status === 'active' ? 'アカウントを事業所から削除しました' : '招待を取り消しました');
          setOpenDeleteDialog(false);
          fetchData(); // 一覧を再取得して表示を更新
      } catch (e) {
          console.error(e);
          showToast(getActionErrorMessage(e, 'エラーが発生しました'), 'error');
          setOpenDeleteDialog(false);
      }
  };

  if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
  const canManageAccounts = checkManagementPermission(currentOrg.effectivePermissions, 'accounts');
  const canManageRoles = checkManagementPermission(currentOrg.effectivePermissions, 'roles');
  const isOwner = currentOrg?.role === 'owner';

  return (
    <PageLayout>
      <InnerPageHeader icon={<KeyIcon />} title="アカウント・権限管理" />

      <PageBody>
          {fetchError != null && <Alert severity="error" action={needsActionRecovery(fetchError) ? <RecoveryLogoutButton /> : <AppButton variant="text" intent="secondary" onClick={() => void fetchData()}>再試行</AppButton>}>{getActionErrorMessage(fetchError)}</Alert>}
          {canManageRoles && (
            <Box sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 0, sm: 1 }, pt: 1 }}>
              {isPending && <LinearProgress />}
              <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
                <Tab label="アカウント" value="accounts" />
                <Tab label="ロール" value="roles" />
              </Tabs>
            </Box>
          )}

          {activeTab === 'accounts' && fetchError == null && (
            <>
            <PageToolbar>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight="bold" color="text.primary">システムログインアカウント</Typography>
                    <Typography variant="caption" color="text.secondary">アプリにログインできるユーザーと、その権限を管理します。</Typography>
                </Box>
                {canManageAccounts && (
                  <AppButton startIcon={<PersonAddIcon />} onClick={() => { setOpenInvite(true); setGeneratedLink(''); setNewInviteName(''); setSelectedInviteStaffId('none'); setSelectedRoleIds([]); }} sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}>
                      新しい人を招待
                  </AppButton>
                )}
            </PageToolbar>

            {isMobile && (
                <Stack divider={<Divider />} sx={{ borderTop: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                    {isFetching ? (
                        <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>
                    ) : accountList.length === 0 ? (
                        <EmptyState title="アカウントがありません" />
                    ) : accountList.map((account) => (
                        <Box key={account.id} sx={{ py: 1.5 }}>
                            <Stack spacing={1.25}>
                                <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
                                    <Box minWidth={0}>
                                        <Typography variant="subtitle2" fontWeight={account.id === currentUserId ? 'bold' : 'normal'} sx={{ color: account.status === 'invited' ? 'text.secondary' : 'text.primary', overflowWrap: 'anywhere' }}>
                                            {account.name} {account.id === currentUserId && <Typography component="span" variant="caption" color="primary" ml={0.5}>(あなた)</Typography>}
                                        </Typography>
                                        <Typography variant="caption" color="text.disabled" display="block" sx={{ overflowWrap: 'anywhere' }}>
                                            {account.status === 'invited' ? '未登録' : (account.email || 'メールアドレス非公開')}
                                        </Typography>
                                        {account.status === 'invited' && account.staffName && (
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
                                                名簿: {account.staffName}
                                            </Typography>
                                        )}
                                    </Box>
                                    {(canManageAccounts || account.id === currentUserId) && (
                                        <IconButton size="small" aria-label={`${account.name}の操作`} onClick={(e) => handleMenuOpen(e, account)} sx={{ flexShrink: 0 }}>
                                            <MoreVertIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>
                                <Box display="flex" gap={0.75} flexWrap="wrap">
                                    {account.role === 'owner' ? (
                                        <Chip label="オーナー" size="small" color="primary" variant="filled" sx={{ fontWeight: 'bold' }} />
                                    ) : account.roles && account.roles.length > 0 ? (
                                        account.roles.map((r) => (
                                            <Chip key={r.id} label={r.name} size="small" variant="outlined" sx={{ borderColor: r.color ?? undefined, color: r.color ?? undefined }} />
                                        ))
                                    ) : (
                                        <Chip label="一般" size="small" color="default" variant="outlined" />
                                    )}
                                    <StatusChip label={account.status === 'active' ? '有効' : '招待中'} tone={account.status === 'active' ? 'success' : 'warning'} size="small" variant="filled" />
                                </Box>
                            </Stack>
                        </Box>
                    ))}
                </Stack>
            )}

            <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
                <Table>
                    <TableHead sx={{ bgcolor: 'background.tint' }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>アカウント情報</TableCell>
                            <TableCell width="160" sx={{ fontWeight: 'bold' }}>システム権限</TableCell>
                            <TableCell width="120" sx={{ fontWeight: 'bold' }}>状態</TableCell>
                            <TableCell align="center" width="80" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isFetching ? (
                            <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
                        ) : accountList.length === 0 ? (
                            <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}><EmptyState title="アカウントがありません" /></TableCell></TableRow>
                        ) : (
                            accountList.map((account) => (
                            <TableRow key={account.id} hover sx={{ height: 60 }}>
                                <TableCell>
                                    <Box>
                                        <Typography variant="body2" fontWeight={account.id === currentUserId ? 'bold' : 'normal'} sx={{ color: account.status === 'invited' ? 'text.secondary' : 'text.primary' }}>
                                            {account.name} {account.id === currentUserId && <Typography component="span" variant="caption" color="primary" ml={1}>(あなた)</Typography>}
                                        </Typography>
                                        <Typography variant="caption" color="text.disabled" display="block">
                                            {account.status === 'invited' ? '未登録' : (account.email || 'メールアドレス非公開')}
                                        </Typography>
                                        {account.status === 'invited' && account.staffName && (
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                名簿: {account.staffName}
                                            </Typography>
                                        )}
                                    </Box>
                                </TableCell>
                                <TableCell>
                                    {account.role === 'owner' ? (
                                        <Chip
                                            label="オーナー"
                                            size="small"
                                            color="primary"
                                            variant="filled"
                                            sx={{ fontWeight: 'bold' }}
                                        />
                                    ) : account.roles && account.roles.length > 0 ? (
                                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                            {account.roles.map((r) => (
                                                <Chip
                                                    key={r.id}
                                                    label={r.name}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ borderColor: r.color ?? undefined, color: r.color ?? undefined }}
                                                />
                                            ))}
                                        </Box>
                                    ) : (
                                        <Chip
                                            label="一般"
                                            size="small"
                                            color="default"
                                            variant="outlined"
                                        />
                                    )}
                                </TableCell>
                                <TableCell>
                                    <StatusChip
                                        label={account.status === 'active' ? '有効' : '招待中'} 
                                        tone={account.status === 'active' ? 'success' : 'warning'}
                                        size="small" 
                                        variant="filled" 
                                    />
                                </TableCell>
                                <TableCell align="center">
                                    {(canManageAccounts || account.id === currentUserId) && (
                                        <IconButton size="small" aria-label={`${account.name}の操作`} onClick={(e) => handleMenuOpen(e, account)}>
                                            <MoreVertIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </TableCell>
                            </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
            </>
          )}

          {activeTab === 'roles' && canManageRoles && (
            <RoleManagementPanel embedded onRolesChanged={fetchData} />
          )}
      </PageBody>

      {/* --- アクションメニュー --- */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
          {selectedAccount?.status === 'invited' && selectedAccount.invitation_code && (
              <MenuItem onClick={() => copyInvitationLink(selectedAccount.invitation_code!)} sx={{ py: 1.5 }}>
                  <ListItemIcon><ContentCopyIcon fontSize="small" color="action" /></ListItemIcon> 
                  招待リンクを再コピー
              </MenuItem>
          )}

          {canManageAccounts && (
              <MenuItem onClick={openRoleEditDialog} sx={{ py: 1.5 }}>
                  <ListItemIcon><SyncAltIcon fontSize="small" color="primary" /></ListItemIcon> 
                  権限を変更
              </MenuItem>
          )}

          {isOwner && selectedAccount?.status === 'active' && selectedAccount.role === 'member' && selectedAccount.id !== currentUserId && (
              <MenuItem onClick={() => {
                  setOwnerTarget({ orgId: currentOrg.id, id: selectedAccount.id, name: selectedAccount.name });
                  handleMenuClose();
              }} sx={{ py: 1.5 }}>
                  <ListItemIcon><PersonAddIcon fontSize="small" color="primary" /></ListItemIcon>
                  オーナーに追加
              </MenuItem>
          )}

          {/* ★修正: onClick を openDeleteConfirmDialog に変更 */}
          <MenuItem disabled={selectedAccount?.role === 'owner' && !isOwner} onClick={openDeleteConfirmDialog} sx={{ color: 'error.main', py: 1.5 }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon> 
              {selectedAccount?.status === 'active' ? 'アカウントを削除' : '招待を取り消す'}
          </MenuItem>
      </Menu>

      {/* --- 削除・取り消し確認ダイアログ (MUI UI) --- */}
      <AppDialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} maxWidth="xs" title={<Stack direction="row" spacing={1} alignItems="center"><ErrorOutlineIcon color="error" />{selectedAccount?.status === 'active' ? 'アカウントの削除' : '招待の取り消し'}</Stack>} dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenDeleteDialog(false)}>キャンセル</AppButton><AppButton onClick={executeDelete} intent="danger">{selectedAccount?.status === 'active' ? '削除する' : '取り消す'}</AppButton></>}>
              <Typography variant="body2" paragraph>
                  {selectedAccount?.status === 'active' 
                      ? `本当に「${selectedAccount?.name}」さんのアカウントをシステムから削除しますか？\n（※この事業所へのログインができなくなります）` 
                      : `「${selectedAccount?.name}」さんへの招待リンクを無効にしますか？`}
              </Typography>
      </AppDialog>

      {/* --- 権限・ロール変更ダイアログ --- */}
      <AppDialog open={openRoleDialog} onClose={() => setOpenRoleDialog(false)} maxWidth="xs" title="権限・ロールの変更" dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenRoleDialog(false)}>キャンセル</AppButton><AppButton onClick={executeRoleChange}>変更を保存</AppButton></>}>
        <Box pt={1}>
          {!isOwner && <Typography id={roleRestrictionId} variant="caption" color="text.secondary">危険な権限を含むロールはオーナーのみ付与できます。</Typography>}
          <Typography variant="body2" mb={2}>
            <b>{selectedAccount?.name}</b> さんの権限を変更します。
          </Typography>
          <Typography variant="body2" color="text.secondary">
            システム権限: {selectedAccount?.role === 'owner' ? 'オーナー' : 'メンバー'}。オーナーの追加は、現在のオーナーが操作メニューの「オーナーに追加」から再認証して行います。
          </Typography>
          {availableRoles.length > 0 && selectedAccount?.status === 'active' && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" mb={1}>割り当てるロール</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {availableRoles.map((role) => {
                  const selected = editOrgRoleIds.includes(role.id);
                  const locked = role.is_dangerous && !isOwner;
                  return (
                    <Chip
                      key={role.id}
                      label={role.name}
                      disabled={locked}
                      aria-describedby={locked ? roleRestrictionId : undefined}
                      onClick={() => {
                        if (locked) return;
                        if (selected) setEditOrgRoleIds(prev => prev.filter(id => id !== role.id));
                        else setEditOrgRoleIds(prev => [...prev, role.id]);
                      }}
                      variant={selected ? 'filled' : 'outlined'}
                      sx={{
                        borderColor: role.color ?? undefined,
                        color: selected ? theme.palette.getContrastText(role.color ?? theme.palette.primary.main) : (role.color ?? undefined),
                        bgcolor: selected ? (role.color ?? undefined) : undefined,
                      }}
                    />
                  );
                })}
              </Box>
            </>
          )}
        </Box>
      </AppDialog>

      <AppDialog open={Boolean(ownerTarget)} title="オーナーに追加" maxWidth="xs"
        onClose={() => { if (!ownerAdding) { setOwnerTarget(null); sessionStorage.removeItem(OWNER_ADD_RESUME_KEY); } }}
        actions={<><AppButton intent="secondary" variant="text" disabled={ownerAdding} onClick={() => { setOwnerTarget(null); sessionStorage.removeItem(OWNER_ADD_RESUME_KEY); }}>キャンセル</AppButton>
          <AppButton loading={ownerAdding} disabled={currentOrg.id !== ownerTarget?.orgId || !isOwner} onClick={executeOwnerAdd}>オーナーに追加</AppButton></>}>
        <Stack spacing={2}>
          <Typography>「{ownerTarget?.name}」さんに、記録の閲覧・出力、権限管理、事業所削除を含むすべての権限を付与します。</Typography>
          <Typography>現在のオーナーは引き続きオーナーです。業務ロールとスタッフの紐付けは維持されます。</Typography>
          <Typography variant="body2" color="text.secondary">追加には本人の再認証が必要です。</Typography>
        </Stack>
      </AppDialog>
      {reauthDialog}

      {/* --- 新規招待ダイアログ --- */}
      <AppDialog open={openInvite} onClose={() => setOpenInvite(false)} maxWidth="xs" title="新しいアカウントの招待" actions={<AppButton variant="text" intent="secondary" onClick={() => setOpenInvite(false)}>閉じる</AppButton>}>
          <Stack spacing={3} alignItems="center" py={1}>
             {!isOwner && <Typography id={roleRestrictionId} variant="caption" color="text.secondary">危険な権限を含むロールはオーナーのみ付与できます。</Typography>}
             {!generatedLink ? (
                 <>
                    {availableRoles.length > 0 && (
                        <Box width="100%">
                          <Typography variant="subtitle2" mb={1}>付与するロール</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {availableRoles.map((role) => {
                              const selected = selectedRoleIds.includes(role.id);
                              const locked = role.is_dangerous && !isOwner;
                              return (
                                <Chip
                                  key={role.id}
                                  label={role.name}
                                  disabled={locked}
                                  aria-describedby={locked ? roleRestrictionId : undefined}
                                  onClick={() => {
                                    if (locked) return;
                                    if (selected) setSelectedRoleIds(prev => prev.filter(id => id !== role.id));
                                    else setSelectedRoleIds(prev => [...prev, role.id]);
                                  }}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{
                                    borderColor: role.color ?? undefined,
                                    color: selected ? theme.palette.getContrastText(role.color ?? theme.palette.primary.main) : (role.color ?? undefined),
                                    bgcolor: selected ? (role.color ?? undefined) : undefined,
                                  }}
                                />
                              );
                            })}
                          </Box>
                        </Box>
                    )}
                    <AppTextField label="招待する人の名前" placeholder="例: 山田 太郎" size="small" fullWidth required value={newInviteName} onChange={(e) => setNewInviteName(e.target.value)} helperText="招待された人の表示名として使われます" />
                    <AppTextField label="招待先メールアドレス" type="email" size="small" fullWidth required value={newInviteEmail} onChange={(e) => setNewInviteEmail(e.target.value)} helperText="このメールアドレスでログインした人だけが72時間以内に利用できます" />
                    <SelectField label="スタッフ名簿との紐付け" size="small" value={selectedInviteStaffId} onChange={setSelectedInviteStaffId}
                      options={[{ value: 'none', label: '紐付けない' }, ...inviteStaffCandidates.map(staff => ({ value: staff.id, label: `${staff.name}${staff.positions?.length ? `（${staff.positions.join('・')}）` : ''}` }))]} />
                    <AppButton variant="contained" onClick={handleGenerateLink} disabled={!newInviteName.trim() || !newInviteEmail.trim()} fullWidth sx={{ py: 1, boxShadow: 'none' }}>招待リンクを発行</AppButton>
                 </>
             ) : (
                 <>
                    <Typography variant="body2" textAlign="center">以下のリンクを相手に共有してください。</Typography>
                    <AppTextField label="招待リンク" value={generatedLink} fullWidth size="small" slotProps={{ input: { readOnly: true, endAdornment: (<IconButton onClick={() => { navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }}><ContentCopyIcon /></IconButton>) } }} />
                    <AppButton intent="secondary" variant="outlined" startIcon={<ShareIcon />} fullWidth onClick={handleShare}>共有メニューを開く</AppButton>
                 </>
             )}
          </Stack>
      </AppDialog>
    </PageLayout>
  );
}
