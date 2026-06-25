'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Chip, IconButton,
  Stack, CircularProgress, Tooltip, TextField,
} from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { AppButton, AppDialog } from '@/components/ui';
import {
  getOrgRolesFull, createOrgRole, updateOrgRole, deleteOrgRole, resetPresetRole,
} from '@/app/actions/roles';
import RolePermissionsMatrix from '@/components/roles/RolePermissionsMatrix';
import ColorPresetPicker from '@/components/roles/ColorPresetPicker';
import type { RolePermissions } from '@/utils/permissions';
import { EMPTY_PERMISSIONS } from '@/utils/permissions';

type OrgRole = {
  id: string;
  name: string;
  color: string | null;
  is_preset: boolean;
  permissions: RolePermissions;
};

export default function RolesPage() {
  const { currentOrg } = useWorkspace();
  const { showToast } = useToast();
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      const data = await getOrgRolesFull(currentOrg.id);
      setRoles(data as OrgRole[]);
    } catch {
      showToast('ロール一覧の取得に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, showToast]);

  useEffect(() => { void fetchRoles(); }, [fetchRoles]);

  if (currentOrg?.role !== 'owner') {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography>この機能はオーナーのみ利用できます。</Typography>
      </Box>
    );
  }

  const openCreate = () => {
    setIsNew(true);
    setEditRole(null);
    setFormName('');
    setFormColor('#6366f1');
    setFormPerms(EMPTY_PERMISSIONS);
  };

  const openEdit = (role: OrgRole) => {
    setIsNew(false);
    setEditRole(role);
    setFormName(role.name);
    setFormColor(role.color ?? '#6366f1');
    setFormPerms(role.permissions);
  };

  const handleSave = async () => {
    if (!currentOrg || !formName.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        await createOrgRole(currentOrg.id, formName.trim(), formColor, formPerms);
        showToast('ロールを作成しました', 'success');
      } else if (editRole) {
        await updateOrgRole(currentOrg.id, editRole.id, { name: formName.trim(), color: formColor, permissions: formPerms });
        showToast('ロールを更新しました', 'success');
      }
      setEditRole(null);
      setIsNew(false);
      await fetchRoles();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentOrg || !deleteTarget) return;
    try {
      await deleteOrgRole(currentOrg.id, deleteTarget.id);
      showToast('ロールを削除しました', 'success');
      setDeleteTarget(null);
      await fetchRoles();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const handleReset = async (role: OrgRole) => {
    if (!currentOrg) return;
    try {
      await resetPresetRole(currentOrg.id, role.id, role.name === '管理者' ? 'manager' : 'staff');
      showToast('プリセットをリセットしました', 'success');
      await fetchRoles();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} spacing={1.5}>
        <Typography variant="h5">ロール管理</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
          ロールを作成
        </Button>
      </Stack>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <Stack spacing={2}>
          {roles.map(role => (
            <Paper key={role.id} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box width={16} height={16} borderRadius="50%" bgcolor={role.color ?? 'grey.400'} flexShrink={0} />
              <Typography fontWeight="medium" flex={1}>{role.name}</Typography>
              {role.is_preset && <Chip label="プリセット" size="small" variant="outlined" />}
              <Stack direction="row" spacing={0.5}>
                {role.is_preset && (
                  <Tooltip title="デフォルト権限にリセット">
                    <IconButton size="small" onClick={() => void handleReset(role)}>
                      <RestoreIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <IconButton size="small" onClick={() => openEdit(role)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                {!role.is_preset && (
                  <IconButton size="small" color="error" onClick={() => setDeleteTarget(role)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* 作成/編集ダイアログ */}
      <AppDialog
        open={isNew || editRole !== null}
        onClose={() => { setIsNew(false); setEditRole(null); }}
        title={isNew ? '新規ロール作成' : 'ロール編集'}
        maxWidth="md"
        fullWidth
      >
        <Stack spacing={2} p={1}>
          <TextField
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
          <RolePermissionsMatrix value={formPerms} onChange={setFormPerms} />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button onClick={() => { setIsNew(false); setEditRole(null); }}>キャンセル</Button>
            <AppButton loading={saving} variant="contained" onClick={() => void handleSave()}>
              {isNew ? '作成' : '保存'}
            </AppButton>
          </Stack>
        </Stack>
      </AppDialog>

      {/* 削除確認ダイアログ */}
      <AppDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="ロールを削除"
      >
        <Typography>
          「{deleteTarget?.name}」を削除しますか？このロールを付与されているメンバーの権限に影響します。
        </Typography>
        <Stack direction="row" justifyContent="flex-end" spacing={1} mt={2}>
          <Button onClick={() => setDeleteTarget(null)}>キャンセル</Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()}>削除</Button>
        </Stack>
      </AppDialog>
    </Box>
  );
}
