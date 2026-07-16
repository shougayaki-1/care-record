'use client';

import { useState, useCallback, useTransition } from 'react';
import type { SyntheticEvent } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, Button, TextField, Stack,
  IconButton, Select, MenuItem, FormControl, InputLabel, Menu, Alert, ListItemIcon,
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
import { createInvitation, getAccountOverview, getInviteStaffCandidates, getOrgRoles, updateAccountRole, updateMemberRoles, removeAccount, type InviteStaffCandidate } from '@/app/actions/accounts';
import { AppButton, AppDialog, InnerPageHeader, PageBody, PageLayout, PageToolbar } from '@/components/ui';
import { checkManagementPermission } from '@/utils/permissions';
import RoleManagementPanel from '@/components/roles/RoleManagementPanel';
import { useFetchData } from '@/hooks/useFetchData';

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
  const { currentOrg, loading: wsLoading } = useWorkspace();
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
  const [editRole, setEditRole] = useState('staff');
  const [editOrgRoleIds, setEditOrgRoleIds] = useState<string[]>([]);
  
  // ★追加：削除（取り消し）確認ダイアログ用
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);

  const fetchAccountsData = useCallback(async (): Promise<AccountsData> => {
    if (!currentOrg) return initialAccountsData;
      const [overview, orgRoles, staffCandidates] = await Promise.all([
        getAccountOverview(currentOrg.id),
        getOrgRoles(currentOrg.id).catch(() => []),
        getInviteStaffCandidates(currentOrg.id).catch(() => []),
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
    loading: isFetching,
    refetch: fetchData,
  } = useFetchData(fetchAccountsData, initialAccountsData, !wsLoading && Boolean(currentOrg), () => {
    showToast('データの取得に失敗しました', 'error');
  });
  const { accountList, currentUserId, availableRoles, inviteStaffCandidates } = accountsData;


  const handleTabChange = useCallback((_: SyntheticEvent, value: 'accounts' | 'roles') => {
    startTransition(() => setActiveTab(value));
  }, [startTransition]);

  const handleGenerateLink = async () => {
    if (!currentOrg) return;
    try {
        const { code } = await createInvitation(currentOrg.id, {
          targetName: newInviteName,
          email: newInviteEmail,
          roleIds: selectedRoleIds,
          staffId: selectedInviteStaffId === 'none' ? null : selectedInviteStaffId,
        });
        setGeneratedLink(`${BASE_URL}/join?code=${code}`);
        fetchData();
    } catch (e) {
        console.error(e);
        showToast(e instanceof Error ? e.message : '招待の発行に失敗しました', 'error');
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
    setEditRole(selectedAccount.role === 'owner' ? 'owner' : 'member');
    setEditOrgRoleIds(selectedAccount.roles?.map(r => r.id) ?? []);
    setOpenRoleDialog(true);
    handleMenuClose();
  };

  const executeRoleChange = async () => {
    if (!currentOrg || !selectedAccount) return;
    try {
      if (selectedAccount.id === currentUserId && selectedAccount.role === 'owner' && editRole !== 'owner') {
        const ownerCount = accountList.filter(a => a.role === 'owner' && a.status === 'active').length;
        if (ownerCount <= 1) {
          showToast('あなたは最後のオーナーです。他の人にオーナー権限を付与してから変更してください。', 'error');
          setOpenRoleDialog(false);
          return;
        }
      }

      await updateAccountRole(currentOrg.id, {
        targetId: selectedAccount.id,
        status: selectedAccount.status === 'active' ? 'active' : 'invited',
        newRole: editRole,
      });

      if (selectedAccount.status === 'active') {
        await updateMemberRoles(currentOrg.id, selectedAccount.id, editOrgRoleIds);
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
          await removeAccount(currentOrg.id, {
              targetId: selectedAccount.id,
              status: selectedAccount.status === 'active' ? 'active' : 'invited',
          });
          showToast(selectedAccount.status === 'active' ? 'アカウントを事業所から削除しました' : '招待を取り消しました');
          setOpenDeleteDialog(false);
          fetchData(); // 一覧を再取得して表示を更新
      } catch (e) {
          console.error(e);
          showToast(e instanceof Error ? e.message : 'エラーが発生しました', 'error');
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
          {canManageRoles && (
            <Box sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 0, sm: 1 }, pt: 1 }}>
              {isPending && <LinearProgress />}
              <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
                <Tab label="アカウント" value="accounts" />
                <Tab label="ロール" value="roles" />
              </Tabs>
            </Box>
          )}

          {activeTab === 'accounts' && (
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
                        <Box sx={{ py: 4, px: 2, textAlign: 'center', color: 'text.secondary' }}>アカウントがありません</Box>
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
                                        <IconButton size="small" onClick={(e) => handleMenuOpen(e, account)} sx={{ flexShrink: 0 }}>
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
                                    <Chip label={account.status === 'active' ? '有効' : '招待中'} color={account.status === 'active' ? 'success' : 'warning'} size="small" variant="filled" />
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
                            <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>アカウントがありません</TableCell></TableRow>
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
                                    <Chip 
                                        label={account.status === 'active' ? '有効' : '招待中'} 
                                        color={account.status === 'active' ? 'success' : 'warning'} 
                                        size="small" 
                                        variant="filled" 
                                    />
                                </TableCell>
                                <TableCell align="center">
                                    {(canManageAccounts || account.id === currentUserId) && (
                                        <IconButton size="small" onClick={(e) => handleMenuOpen(e, account)}>
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

          {/* ★修正: onClick を openDeleteConfirmDialog に変更 */}
          <MenuItem onClick={openDeleteConfirmDialog} sx={{ color: 'error.main', py: 1.5 }}>
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
          <Typography variant="body2" mb={2}>
            <b>{selectedAccount?.name}</b> さんの権限を変更します。
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>システム権限</InputLabel>
            <Select value={editRole} onChange={(e) => setEditRole(e.target.value)} label="システム権限">
              <MenuItem value="member">メンバー - 権限はロールで管理</MenuItem>
              {selectedAccount?.status === 'active' && (
                <MenuItem value="owner">オーナー - 所有者</MenuItem>
              )}
            </Select>
          </FormControl>
          {selectedAccount?.id === currentUserId && editRole !== 'owner' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              自分の所有者区分を変更すると、再度オーナーに戻るには別のオーナーによる移譲が必要です。
            </Alert>
          )}
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
                      onClick={() => {
                        if (locked) return;
                        if (selected) setEditOrgRoleIds(prev => prev.filter(id => id !== role.id));
                        else setEditOrgRoleIds(prev => [...prev, role.id]);
                      }}
                      variant={selected ? 'filled' : 'outlined'}
                      sx={{
                        cursor: locked ? 'not-allowed' : 'pointer',
                        opacity: locked ? 0.4 : 1,
                        borderColor: role.color ?? undefined,
                        color: selected ? '#fff' : (role.color ?? undefined),
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

      {/* --- 新規招待ダイアログ --- */}
      <AppDialog open={openInvite} onClose={() => setOpenInvite(false)} maxWidth="xs" title="新しいアカウントの招待" actions={<AppButton variant="text" intent="secondary" onClick={() => setOpenInvite(false)}>閉じる</AppButton>}>
          <Stack spacing={3} alignItems="center" py={1}>
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
                                  onClick={() => {
                                    if (locked) return;
                                    if (selected) setSelectedRoleIds(prev => prev.filter(id => id !== role.id));
                                    else setSelectedRoleIds(prev => [...prev, role.id]);
                                  }}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{
                                    cursor: locked ? 'not-allowed' : 'pointer',
                                    opacity: locked ? 0.4 : 1,
                                    borderColor: role.color ?? undefined,
                                    color: selected ? '#fff' : (role.color ?? undefined),
                                    bgcolor: selected ? (role.color ?? undefined) : undefined,
                                  }}
                                />
                              );
                            })}
                          </Box>
                        </Box>
                    )}
                    <TextField label="招待する人の名前" placeholder="例: 山田 太郎" size="small" fullWidth required value={newInviteName} onChange={(e) => setNewInviteName(e.target.value)} helperText="招待された人の表示名として使われます" />
                    <TextField label="招待先メールアドレス" type="email" size="small" fullWidth required value={newInviteEmail} onChange={(e) => setNewInviteEmail(e.target.value)} helperText="このメールアドレスでログインした人だけが72時間以内に利用できます" />
                    <FormControl fullWidth size="small">
                      <InputLabel>スタッフ名簿との紐付け</InputLabel>
                      <Select value={selectedInviteStaffId} onChange={(e) => setSelectedInviteStaffId(e.target.value)} label="スタッフ名簿との紐付け">
                        <MenuItem value="none">紐付けない</MenuItem>
                        {inviteStaffCandidates.map((staff) => (
                          <MenuItem key={staff.id} value={staff.id}>
                            {staff.name}{staff.positions && staff.positions.length > 0 ? `（${staff.positions.join('・')}）` : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button variant="contained" onClick={handleGenerateLink} disabled={!newInviteName.trim() || !newInviteEmail.trim()} fullWidth sx={{ py: 1, boxShadow: 'none' }}>招待リンクを発行</Button>
                 </>
             ) : (
                 <>
                    <Typography variant="body2" textAlign="center">以下のリンクを相手に共有してください。</Typography>
                    <TextField value={generatedLink} fullWidth size="small" slotProps={{ input: { readOnly: true, endAdornment: (<IconButton onClick={() => { navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }}><ContentCopyIcon /></IconButton>) } }} />
                    <Button variant="outlined" startIcon={<ShareIcon />} fullWidth onClick={handleShare}>共有メニューを開く</Button>
                 </>
             )}
          </Stack>
      </AppDialog>
    </PageLayout>
  );
}
