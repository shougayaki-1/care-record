'use client';
import { useId, useState } from 'react';
import { Box, Typography, Chip, Stack, IconButton } from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, SelectField } from '@/components/ui';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import { useTheme } from '@mui/material/styles';
import { useToast } from '@/components/ui/ToastProvider';
import { createInvitation, type InviteStaffCandidate } from '@/app/actions/accounts';
import { readActionResult, getActionErrorMessage } from '@/utils/actionResult';
import type { Workspace } from '@/context/WorkspaceContext';
import type { OrgRoleOption } from './types';
import { useAccountOperation } from './useAccountOperation';

type Props = { currentOrg: Workspace; availableRoles: OrgRoleOption[]; inviteStaffCandidates: InviteStaffCandidate[]; onClose: () => void; onSuccess: () => Promise<void> };
export function InvitationDialog({ currentOrg, availableRoles, inviteStaffCandidates, onClose, onSuccess }: Props) {
  const { showToast } = useToast();
  const theme = useTheme();
  const roleRestrictionId = useId();
  const isOwner = currentOrg.role === 'owner';
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [selectedInviteStaffId, setSelectedInviteStaffId] = useState('none');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const { busy, run } = useAccountOperation();
  const handleGenerateLink = () => run(async isCurrent => {
    try {
      const { code } = await readActionResult(createInvitation(currentOrg.id, {
        targetName: newInviteName, email: newInviteEmail, roleIds: selectedRoleIds,
        staffId: selectedInviteStaffId === 'none' ? null : selectedInviteStaffId,
      }));
      if (!isCurrent()) return;
      setGeneratedLink(`${window.location.origin}/join?code=${code}`);
      await onSuccess();
    } catch (error) {
      if (isCurrent()) showToast(getActionErrorMessage(error, '招待の発行に失敗しました'), 'error');
    }
  });
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }
    catch { showToast('リンクのコピーに失敗しました', 'error'); }
  };
  const handleShare = async () => {
    if (!navigator.share) { await copyLink(); return; }
    try { await navigator.share({ title: 'CareRecordへの招待', text: `${currentOrg.name}への招待が届いています。`, url: generatedLink }); }
    catch { /* 共有メニューのキャンセル時もリンクを保持する。 */ }
  };
  return (
      <AppDialog open loading={busy} onClose={onClose} maxWidth="xs" title="新しいアカウントの招待" actions={<AppButton variant="text" intent="secondary" disabled={busy} onClick={onClose}>閉じる</AppButton>}>
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
                                  disabled={locked || busy}
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
                    <AppTextField label="招待する人の名前" placeholder="例: 山田 太郎" size="small" fullWidth required disabled={busy} value={newInviteName} onChange={(e) => setNewInviteName(e.target.value)} helperText="招待された人の表示名として使われます" />
                    <AppTextField label="招待先メールアドレス" type="email" size="small" fullWidth required disabled={busy} value={newInviteEmail} onChange={(e) => setNewInviteEmail(e.target.value)} helperText="このメールアドレスでログインした人だけが72時間以内に利用できます" />
                    <SelectField label="スタッフ名簿との紐付け" size="small" disabled={busy} value={selectedInviteStaffId} onChange={setSelectedInviteStaffId}
                      options={[{ value: 'none', label: '紐付けない' }, ...inviteStaffCandidates.map(staff => ({ value: staff.id, label: `${staff.name}${staff.positions?.length ? `（${staff.positions.join('・')}）` : ''}` }))]} />
                    <AppButton variant="contained" onClick={handleGenerateLink} loading={busy} disabled={!newInviteName.trim() || !newInviteEmail.trim()} fullWidth sx={{ py: 1, boxShadow: 'none' }}>招待リンクを発行</AppButton>
                 </>
             ) : (
                 <>
                    <Typography variant="body2" textAlign="center">以下のリンクを相手に共有してください。</Typography>
                    <AppTextField label="招待リンク" value={generatedLink} fullWidth size="small" slotProps={{ input: { readOnly: true, endAdornment: (<IconButton aria-label="招待リンクをコピー" onClick={() => void copyLink()}><ContentCopyIcon /></IconButton>) } }} />
                    <AppButton intent="secondary" variant="outlined" startIcon={<ShareIcon />} fullWidth onClick={handleShare}>共有メニューを開く</AppButton>
                 </>
             )}
          </Stack>
      </AppDialog>
  );
}
