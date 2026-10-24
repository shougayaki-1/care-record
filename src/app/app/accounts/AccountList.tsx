'use client';
import { useState } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Stack, IconButton, MenuItem, Menu, ListItemIcon, CircularProgress, Divider } from '@/components/ui/mui';
import { StatusChip, EmptyState } from '@/components/ui';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import type { AccountProfile } from './types';

type Props = {
  isMobile: boolean; accountList: AccountProfile[]; currentUserId: string; isFetching: boolean;
  canManageAccounts: boolean; isOwner: boolean;
  onEditRoles: (account: AccountProfile) => void;
  onRemove: (account: AccountProfile) => void;
  onAddOwner: (account: AccountProfile) => void;
  onCopyInvitation: (code: string) => void;
};
export function AccountList({ isMobile, accountList, currentUserId, isFetching, canManageAccounts, isOwner, onEditRoles, onRemove, onAddOwner, onCopyInvitation }: Props) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountProfile | null>(null);
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, account: AccountProfile) => {
    setMenuAnchor(event.currentTarget); setSelectedAccount(account);
  };
  const handleMenuClose = () => setMenuAnchor(null);
  const copyInvitationLink = (code: string) => { onCopyInvitation(code); handleMenuClose(); };
  return <>
    {isMobile && (
        <Stack divider={<Divider />} sx={{ borderTop: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            {isFetching ? (
                <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} aria-label="アカウントを取得中" /></Box>
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
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
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

    {!isMobile && <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
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
                    <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><CircularProgress size={24} aria-label="アカウントを取得中" /></TableCell></TableRow>
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
                                <Typography variant="caption" color="text.secondary" display="block">
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
    </TableContainer>}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
          {selectedAccount?.status === 'invited' && selectedAccount.invitation_code && (
              <MenuItem onClick={() => copyInvitationLink(selectedAccount.invitation_code!)} sx={{ py: 1.5 }}>
                  <ListItemIcon><ContentCopyIcon fontSize="small" color="action" /></ListItemIcon>
                  招待リンクを再コピー
              </MenuItem>
          )}

          {canManageAccounts && (
              <MenuItem onClick={() => { if (selectedAccount) onEditRoles(selectedAccount); handleMenuClose(); }} sx={{ py: 1.5 }}>
                  <ListItemIcon><SyncAltIcon fontSize="small" color="primary" /></ListItemIcon>
                  権限を変更
              </MenuItem>
          )}

          {isOwner && selectedAccount?.status === 'active' && selectedAccount.role === 'member' && selectedAccount.id !== currentUserId && (
              <MenuItem onClick={() => {
                  onAddOwner(selectedAccount);
                  handleMenuClose();
              }} sx={{ py: 1.5 }}>
                  <ListItemIcon><PersonAddIcon fontSize="small" color="primary" /></ListItemIcon>
                  オーナーに追加
              </MenuItem>
          )}

          <MenuItem disabled={selectedAccount?.role === 'owner' && !isOwner} onClick={() => { if (selectedAccount) onRemove(selectedAccount); handleMenuClose(); }} sx={{ color: 'error.main', py: 1.5 }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              {selectedAccount?.status === 'active' ? 'アカウントを削除' : '招待を取り消す'}
          </MenuItem>
      </Menu>

  </>;
}
