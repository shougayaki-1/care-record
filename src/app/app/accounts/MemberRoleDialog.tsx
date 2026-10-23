'use client';
import { useId, useState } from 'react';
import { Box, Typography, Chip, Divider } from '@/components/ui/mui';
import { AppButton, AppDialog } from '@/components/ui';
import { useTheme } from '@mui/material/styles';
import { useToast } from '@/components/ui/ToastProvider';
import { updateMemberRoles } from '@/app/actions/accounts';
import { readActionResult } from '@/utils/actionResult';
import { useAccountOperation } from './useAccountOperation';
import type { AccountProfile, OrgRoleOption } from './types';

type Props = { orgId: string; selectedAccount: AccountProfile; currentUserId: string; availableRoles: OrgRoleOption[]; isOwner: boolean; onClose: () => void; onSuccess: () => Promise<void> };
export function MemberRoleDialog({ orgId, selectedAccount, currentUserId, availableRoles, isOwner, onClose, onSuccess }: Props) {
  const { showToast } = useToast();
  const theme = useTheme();
  const roleRestrictionId = useId();
  const [editOrgRoleIds, setEditOrgRoleIds] = useState(selectedAccount.roles.map(role => role.id));
  const { busy, run } = useAccountOperation();
  const executeRoleChange = () => run(async isCurrent => {
    try {
      if (selectedAccount.status === 'active') await readActionResult(updateMemberRoles(orgId, selectedAccount.id, editOrgRoleIds));
      if (!isCurrent()) return;
      showToast('権限を変更しました');
      void onSuccess();
      onClose();
      if (selectedAccount.id === currentUserId) setTimeout(() => window.location.reload(), 1000);
    } catch {
      if (isCurrent()) showToast('変更に失敗しました', 'error');
    }
  });
  return (
      <AppDialog open loading={busy} onClose={onClose} maxWidth="xs" title="権限・ロールの変更" dividers={false} actions={<><AppButton variant="text" intent="secondary" disabled={busy} onClick={onClose}>キャンセル</AppButton><AppButton loading={busy} onClick={executeRoleChange}>変更を保存</AppButton></>}>
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
                      disabled={locked || busy}
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

  );
}
