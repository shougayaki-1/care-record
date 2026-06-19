'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Chip, Button, TextField, Stack,
  IconButton, Select, MenuItem, FormControl, InputLabel, Menu, Alert, ListItemIcon,
  CircularProgress
} from '@/components/ui/mui';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import ShareIcon from '@mui/icons-material/Share';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SyncAltIcon from '@mui/icons-material/SyncAlt'; 
import KeyIcon from '@mui/icons-material/Key';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { createInvitation, getAccountOverview, updateAccountRole, removeAccount } from '@/app/actions/accounts';
import { AppButton, AppDialog } from '@/components/ui';
import { hasOrganizationPermission } from '@/utils/permissions';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

type AccountProfile = { 
    id: string; 
    name: string; 
    email?: string; 
    role: string; 
    status: 'active' | 'invited'; 
    invitation_code?: string; 
};

export default function AccountsPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  
  const [isFetching, setIsFetching] = useState(true);
  const [accountList, setAccountList] = useState<AccountProfile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  // 新規招待用
  const [openInvite, setOpenInvite] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteRole, setNewInviteRole] = useState('staff');

  // 操作メニュー用
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountProfile | null>(null);

  // ダイアログ用
  const [openRoleDialog, setOpenRoleDialog] = useState(false);
  const [editRole, setEditRole] = useState('staff');
  
  // ★追加：削除（取り消し）確認ダイアログ用
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentOrg) return;
    setIsFetching(true);
    try {
      const overview = await getAccountOverview(currentOrg.id);
      setCurrentUserId(overview.currentUserId);
      const mergedList: AccountProfile[] = overview.accounts;
      
      mergedList.sort((a, b) => {
          if (a.id === currentUserId) return -1;
          if (b.id === currentUserId) return 1;
          if (a.role === 'owner' && b.role !== 'owner') return -1;
          if (a.role !== 'owner' && b.role === 'owner') return 1;
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          return 0;
      });

      setAccountList(mergedList);
    } catch (e) { 
        console.error(e); 
        showToast('データの取得に失敗しました', 'error');
    } finally {
        setIsFetching(false);
    }
  }, [currentOrg, currentUserId, showToast]);

  useEffect(() => { if (!wsLoading && currentOrg) fetchData(); }, [wsLoading, currentOrg, fetchData]);

  const handleGenerateLink = async () => {
    if (!currentOrg) return;
    try {
        const { code } = await createInvitation(currentOrg.id, { targetName: newInviteName, role: newInviteRole });
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
      setEditRole(selectedAccount.role);
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

          showToast('権限を変更しました');
          setOpenRoleDialog(false);
          fetchData();

          if (selectedAccount.id === currentUserId && editRole !== 'owner') {
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
  const isOwner = hasOrganizationPermission(currentOrg.role, 'manageAccounts');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <KeyIcon sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary">アカウント(権限)管理</Typography>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: 'background.default' }}>
        <Box maxWidth="lg" mx="auto">
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 3, boxShadow: 'none', border: 'none', bgcolor: 'transparent' }}>
                <Box>
                    <Typography variant="subtitle1" fontWeight="bold" color="text.primary">システムログインアカウント</Typography>
                    <Typography variant="caption" color="text.secondary">アプリにログインできるユーザーと、その権限を管理します。</Typography>
                </Box>
                {isOwner && (
                  <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => { setOpenInvite(true); setGeneratedLink(''); setNewInviteName(''); setNewInviteRole('staff'); }} sx={{ boxShadow: 'none' }}>
                      新しい人を招待
                  </Button>
                )}
            </Paper>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
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
                                    </Box>
                                </TableCell>
                                <TableCell>
                                    <Chip 
                                        label={account.role === 'owner' ? 'オーナー' : (account.role === 'manager' ? '管理者' : '一般(ヘルパー)')} 
                                        size="small" 
                                        color={account.role === 'owner' ? 'primary' : 'default'} 
                                        variant={account.role === 'owner' ? 'filled' : 'outlined'}
                                        sx={{ fontWeight: account.role === 'owner' ? 'bold' : 'normal' }}
                                    />
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
                                    {(isOwner || account.id === currentUserId) && (
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
        </Box>
      </Box>

      {/* --- アクションメニュー --- */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
          {selectedAccount?.status === 'invited' && selectedAccount.invitation_code && (
              <MenuItem onClick={() => copyInvitationLink(selectedAccount.invitation_code!)} sx={{ py: 1.5 }}>
                  <ListItemIcon><ContentCopyIcon fontSize="small" color="action" /></ListItemIcon> 
                  招待リンクを再コピー
              </MenuItem>
          )}

          {isOwner && (
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

      {/* --- 権限変更ダイアログ --- */}
      <AppDialog open={openRoleDialog} onClose={() => setOpenRoleDialog(false)} maxWidth="xs" title="権限の変更" dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenRoleDialog(false)}>キャンセル</AppButton><AppButton onClick={executeRoleChange}>変更を保存</AppButton></>}>
              <Box pt={1}>
                  <Typography variant="body2" mb={2}>
                      <b>{selectedAccount?.name}</b> さんのシステム権限を変更します。
                  </Typography>
                  <FormControl fullWidth size="small">
                      <InputLabel>システム権限</InputLabel>
                      <Select value={editRole} onChange={(e) => setEditRole(e.target.value)} label="システム権限">
                          <MenuItem value="staff">一般(ヘルパー) - 記録の作成のみ</MenuItem>
                          <MenuItem value="manager">管理者 - シフト管理・利用者管理</MenuItem>
                          {selectedAccount?.status === 'active' && (
                            <MenuItem value="owner">オーナー - 全ての権限・事業所設定</MenuItem>
                          )}
                      </Select>
                  </FormControl>
                  {selectedAccount?.id === currentUserId && editRole !== 'owner' && (
                      <Alert severity="warning" sx={{ mt: 2 }}>
                          自分の権限を降格させると、再度オーナーに戻ることはできません。
                      </Alert>
                  )}
              </Box>
      </AppDialog>

      {/* --- 新規招待ダイアログ --- */}
      <AppDialog open={openInvite} onClose={() => setOpenInvite(false)} maxWidth="xs" title="新しいアカウントの招待" actions={<AppButton variant="text" intent="secondary" onClick={() => setOpenInvite(false)}>閉じる</AppButton>}>
          <Stack spacing={3} alignItems="center" py={1}>
             {!generatedLink ? (
                 <>
                    <FormControl fullWidth size="small">
                        <InputLabel>システム権限</InputLabel>
                        <Select label="システム権限" value={newInviteRole} onChange={(e) => setNewInviteRole(e.target.value as string)}>
                            <MenuItem value="staff">一般(ヘルパー)</MenuItem>
                            <MenuItem value="manager">管理者</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField label="管理用の名前 (任意)" placeholder="例: 山田 太郎" size="small" fullWidth value={newInviteName} onChange={(e) => setNewInviteName(e.target.value)} />
                    <Button variant="contained" onClick={handleGenerateLink} fullWidth sx={{ py: 1, boxShadow: 'none' }}>招待リンクを発行</Button>
                 </>
             ) : (
                 <>
                    <Typography variant="body2" textAlign="center">相手にこのQRコードを読み取ってもらうか、<br/>リンクを共有してください。</Typography>
                    <Box component="img" src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(generatedLink)}`} alt="QR Code" sx={{ width: 150, height: 150, border: '1px solid', borderColor: 'divider', p: 1, borderRadius: 2 }} />
                    <TextField value={generatedLink} fullWidth size="small" slotProps={{ input: { readOnly: true, endAdornment: (<IconButton onClick={() => { navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }}><ContentCopyIcon /></IconButton>) } }} />
                    <Button variant="outlined" startIcon={<ShareIcon />} fullWidth onClick={handleShare}>共有メニューを開く</Button>
                 </>
             )}
          </Stack>
      </AppDialog>
    </Box>
  );
}
