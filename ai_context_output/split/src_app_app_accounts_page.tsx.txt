'use client';

import { useEffect, useMemo } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Chip, Button, IconButton, Menu, MenuItem, ListItemIcon, CircularProgress
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SyncAltIcon from '@mui/icons-material/SyncAlt'; 
import KeyIcon from '@mui/icons-material/Key';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// 子コンポーネントおよび新設フックのインポート
import { InviteDialog } from './_components/InviteDialog';
import { RoleChangeDialog } from './_components/RoleChangeDialog';
import { DeleteConfirmDialog } from './_components/DeleteConfirmDialog';
import { useAccountManager } from './_hooks/useAccountManager';

export default function AccountsPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const { user: currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id || '';

  const BASE_URL = useMemo(() => {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }, []);
  
  // アカウント用ビジネスロジックフックの適用
  const {
    isFetching,
    accountList,
    openInvite,
    setOpenInvite,
    generatedLink,
    setGeneratedLink,
    newInviteName,
    setNewInviteName,
    newInviteRole,
    setNewInviteRole,
    menuAnchor,
    setMenuAnchor,
    selectedAccount,
    openRoleDialog,
    setOpenRoleDialog,
    editRole,
    setEditRole,
    openDeleteDialog,
    setOpenDeleteDialog,
    fetchData,
    handleGenerateLink,
    handleShare,
    handleMenuOpen,
    handleMenuClose,
    openRoleEditDialog,
    executeRoleChange,
    openDeleteConfirmDialog,
    executeDelete
  } = useAccountManager(currentOrg, currentUserId);

  useEffect(() => { 
    if (!wsLoading && currentOrg) {
      fetchData(); 
    }
  }, [wsLoading, currentOrg, fetchData]);

  const copyInvitationLink = (code: string) => {
      const url = `${BASE_URL}/join?code=${code}`;
      navigator.clipboard.writeText(url);
      showToast('招待リンクをコピーしました');
      handleMenuClose();
  };

  if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
  const isOwner = currentOrg.role === 'owner';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <KeyIcon sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary">アカウント(権限)管理</Typography>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
        <Box maxWidth="lg" mx="auto">
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 3, boxShadow: 'none', border: 'none', bgcolor: 'transparent' }}>
                <Box>
                    <Typography variant="subtitle1" fontWeight="bold" color="text.primary">システムログインアカウント</Typography>
                    <Typography variant="caption" color="text.secondary">アプリにログインできるユーザーと、その権限を管理します。</Typography>
                </Box>
                <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => { setOpenInvite(true); setGeneratedLink(''); setNewInviteName(''); setNewInviteRole('staff'); }} sx={{ boxShadow: 'none' }}>
                    新しい人を招待
                </Button>
            </Paper>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
                <Table>
                    <TableHead sx={{ bgcolor: '#F0F5FF' }}>
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

          <MenuItem onClick={openDeleteConfirmDialog} sx={{ color: 'error.main', py: 1.5 }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon> 
              {selectedAccount?.status === 'active' ? 'アカウントを削除' : '招待を取り消す'}
          </MenuItem>
      </Menu>

      <InviteDialog 
          open={openInvite}
          onClose={() => setOpenInvite(false)}
          orgName={currentOrg.name}
          generatedLink={generatedLink}
          newInviteName={newInviteName}
          setNewInviteName={setNewInviteName}
          newInviteRole={newInviteRole}
          setNewInviteRole={setNewInviteRole}
          onGenerate={() => handleGenerateLink(BASE_URL)}
          onShare={handleShare}
          showToast={showToast}
      />

      <RoleChangeDialog 
          open={openRoleDialog}
          onClose={() => setOpenRoleDialog(false)}
          accountName={selectedAccount?.name || ''}
          editRole={editRole}
          setEditRole={setEditRole}
          isSelf={selectedAccount?.id === currentUserId}
          onConfirm={executeRoleChange}
      />

      <DeleteConfirmDialog 
          open={openDeleteDialog}
          onClose={() => setOpenDeleteDialog(false)}
          status={selectedAccount?.status}
          accountName={selectedAccount?.name || ''}
          onConfirm={executeDelete}
      />
    </Box>
  );
}