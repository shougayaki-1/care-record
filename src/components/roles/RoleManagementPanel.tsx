'use client';
import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, IconButton,
  Stack, CircularProgress, Alert,
} from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import { AppButton, AppDialog, AppTextField, SectionCard, EmptyState } from '@/components/ui';
import {
  getOrgRolesFull, createOrgRole, updateOrgRole, deleteOrgRole,
} from '@/app/actions/roles';
import RolePermissionsMatrix from '@/components/roles/RolePermissionsMatrix';
import ColorPresetPicker from '@/components/roles/ColorPresetPicker';
import type { RolePermissions } from '@/utils/permissions';
import { checkManagementPermission, EMPTY_PERMISSIONS, normalizePermissions } from '@/utils/permissions';

function isDangerousPermissions(permissions: RolePermissions) {
  const { accounts, roles, organizationDelete, ownerTransfer } = permissions.management;
  return accounts || roles || organizationDelete || ownerTransfer;
}

type OrgRole = {
  id: string;
  name: string;
  color: string | null;
  is_preset: boolean;
  permissions: RolePermissions;
};

type Props = {
  embedded?: boolean;
  onRolesChanged?: () => void | Promise<void>;
};

export default function RoleManagementPanel({ embedded = false, onRolesChanged }: Props) {
  const { currentOrg } = useWorkspace();
  const { showToast } = useToast();
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [editRole, setEditRole] = useState<OrgRole | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#6366f1');
  const [formPerms, setFormPerms] = useState<RolePermissions>(EMPTY_PERMISSIONS);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrgRole | null>(null);

  const fetchRoles = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await readActionResult(getOrgRolesFull(currentOrg.id));
      setRoles((data as unknown as OrgRole[]).map((role) => ({ ...role, permissions: normalizePermissions(role.permissions) })));
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  const refreshAfterChange = async () => {
    await fetchRoles();
    await onRolesChanged?.();
  };

  useEffect(() => {
    queueMicrotask(() => void fetchRoles());
  }, [fetchRoles]);

  if (!currentOrg || !checkManagementPermission(currentOrg.effectivePermissions, 'roles')) {
    return (
      <Box sx={{ p: embedded ? 0 : { xs: 2, sm: 3 } }}>
        <Typography>この機能にはロール管理権限が必要です。</Typography>
      </Box>
    );
  }

  const openCreate = () => {
    setIsNew(true);
    setEditRole(null);
    setFormName('');
    setFormColor('#6366f1');
    setFormPerms(normalizePermissions(EMPTY_PERMISSIONS));
  };

  const openEdit = (role: OrgRole) => {
    setIsNew(false);
    setEditRole(role);
    setFormName(role.name);
    setFormColor(role.color ?? '#6366f1');
    setFormPerms(normalizePermissions(role.permissions));
  };

  const handleSave = async () => {
    if (!currentOrg || !formName.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        await readActionResult(createOrgRole(currentOrg.id, formName.trim(), formColor, formPerms));
        showToast('ロールを作成しました', 'success');
      } else if (editRole) {
        await readActionResult(updateOrgRole(currentOrg.id, editRole.id, { name: formName.trim(), color: formColor, permissions: formPerms }));
        showToast('ロールを更新しました', 'success');
      }
      setEditRole(null);
      setIsNew(false);
      await refreshAfterChange();
    } catch (e) {
      showToast(getActionErrorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentOrg || !deleteTarget) return;
    try {
      await readActionResult(deleteOrgRole(currentOrg.id, deleteTarget.id));
      showToast('ロールを削除しました', 'success');
      setDeleteTarget(null);
      await refreshAfterChange();
    } catch (e) {
      showToast(getActionErrorMessage(e), 'error');
    }
  };

  return (
    <Box sx={{ p: embedded ? 0 : { xs: 2, sm: 3 }, maxWidth: 'none', width: '100%' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} spacing={1.5}>
        <Box>
          <Typography variant={embedded ? 'subtitle1' : 'h5'} fontWeight={embedded ? 'bold' : undefined}>ロール管理</Typography>
          {embedded && (
            <Typography variant="caption" color="text.secondary">
              アカウントに割り当てる権限セットを作成・編集します。
            </Typography>
          )}
        </Box>
        <AppButton startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
          ロールを作成
        </AppButton>
      </Stack>

      {Boolean(loadError) && <Alert severity="error" sx={{ mb: 2 }}>
        {getActionErrorMessage(loadError)}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <AppButton size="small" variant="outlined" intent="secondary" onClick={() => void fetchRoles()}>再試行</AppButton>
          {needsActionRecovery(loadError) && <RecoveryLogoutButton attemptClientLogout={false} />}
        </Stack>
      </Alert>}
      {currentOrg.role !== 'owner'  && <Typography variant="caption" color="text.secondary">危険な権限を含むロールの編集・削除はオーナーのみ実行できます。</Typography>}
      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <Stack spacing={2}>
          {!loadError && roles.length === 0 && <EmptyState title="ロールがありません" />}
          {roles.map(role => (
            <SectionCard key={role.id} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box width={16} height={16} borderRadius="50%" bgcolor={role.color ?? 'grey.400'} flexShrink={0} />
              <Typography fontWeight="medium" flex={1}>{role.name}</Typography>
              <Stack direction="row" spacing={0.5}>
                <IconButton aria-label={`${role.name}を編集`} disabled={currentOrg.role !== 'owner' && isDangerousPermissions(role.permissions)} size="small" onClick={() => openEdit(role)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                {!role.is_preset && (
                  <IconButton aria-label={`${role.name}を削除`} disabled={currentOrg.role !== 'owner' && isDangerousPermissions(role.permissions)} size="small" color="error" onClick={() => setDeleteTarget(role)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </SectionCard>
          ))}
        </Stack>
      )}

      <AppDialog
        open={isNew || editRole !== null}
        onClose={() => { setIsNew(false); setEditRole(null); }}
        title={isNew ? '新規ロール作成' : 'ロール編集'}
        maxWidth="sm"
        fullWidth
        contentSx={{ overflowX: 'auto' }}
        actions={(
          <>
            <AppButton intent="secondary" variant="text" onClick={() => { setIsNew(false); setEditRole(null); }}>キャンセル</AppButton>
            <AppButton loading={saving} variant="contained" onClick={() => void handleSave()}>
              {isNew ? '作成' : '保存'}
            </AppButton>
          </>
        )}
        actionsSx={{
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          '& > :not(style)': {
            width: { xs: '100%', sm: 'auto' },
            m: { xs: 0, sm: undefined },
          },
        }}
      >
        <Stack spacing={2} sx={{ p: { xs: 0, sm: 1 }, minWidth: 0 }}>
          <AppTextField
            label="ロール名"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            required
            fullWidth
            size="small"
          />
          <Box>
            <Typography variant="caption" display="block" mb={0.5}>カラー</Typography>
            <ColorPresetPicker value={formColor} onChange={setFormColor} />
          </Box>
          <RolePermissionsMatrix isOwner={currentOrg.role === 'owner'} disabled={saving} value={formPerms} onChange={setFormPerms} />
        </Stack>
      </AppDialog>

      <AppDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="ロールを削除"
        actions={(
          <>
            <AppButton intent="secondary" variant="text" onClick={() => setDeleteTarget(null)}>キャンセル</AppButton>
            <AppButton intent="danger" variant="contained" onClick={() => void handleDelete()}>削除</AppButton>
          </>
        )}
        actionsSx={{
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          '& > :not(style)': {
            width: { xs: '100%', sm: 'auto' },
            m: { xs: 0, sm: undefined },
          },
        }}
      >
        <Typography>
          「{deleteTarget?.name}」を削除しますか？このロールを付与されているメンバーの権限に影響します。
        </Typography>
      </AppDialog>
    </Box>
  );
}
