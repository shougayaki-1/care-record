'use client';

import { useEffect, useState } from 'react';
import {
  Box, Stack, CircularProgress, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, SwitchField } from '@/components/ui';
import {
  getStaffRoles, createStaffRole, updateStaffRole, deleteStaffRole,
  type StaffRole,
} from '@/app/actions/staffRoles';

export default function StaffRoleSettings({
  orgId,
  initialStaffRoles,
}: {
  orgId: string;
  initialStaffRoles?: StaffRole[];
}) {
  const [rows, setRows] = useState<StaffRole[]>(initialStaffRoles ?? []);
  const [loading, setLoading] = useState(initialStaffRoles === undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<StaffRole | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnpaid, setEditUnpaid] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUnpaid, setAddUnpaid] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<StaffRole | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getStaffRoles(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialStaffRoles !== undefined) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const handleToggleActive = async (row: StaffRole) => {
    try {
      await updateStaffRole(orgId, row.id, { is_active: !row.is_active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  const handleEditOpen = (row: StaffRole) => {
    setEditTarget(row);
    setEditName(row.name);
    setEditUnpaid(row.is_unpaid);
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget || !editName.trim()) return;
    setSaving(true);
    try {
      await updateStaffRole(orgId, editTarget.id, { name: editName.trim(), is_unpaid: editUnpaid });
      setEditOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSave = async () => {
    if (!addName.trim()) return;
    setSaving(true);
    try {
      await createStaffRole(orgId, addName.trim(), addUnpaid);
      setAddOpen(false);
      setAddName('');
      setAddUnpaid(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteStaffRole(orgId, deleteTarget.id);
      setDeleteOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box py={3} textAlign="center"><CircularProgress size={24} /></Box>;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 420 }}>
          <TableHead>
            <TableRow>
              <TableCell>役割名</TableCell>
              <TableCell>無給（ボランティア等）</TableCell>
              <TableCell>有効</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} align="center">設定なし</TableCell></TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell sx={{ minWidth: 140 }}>{row.name}</TableCell>
                  <TableCell>
                    {row.is_unpaid && <Chip size="small" label="無給" color="warning" variant="outlined" />}
                  </TableCell>
                  <TableCell>
                    <SwitchField checked={row.is_active} onChange={() => handleToggleActive(row)} size="small" />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <AppButton variant="text" intent="secondary" size="small" onClick={() => handleEditOpen(row)}>編集</AppButton>
                      <AppButton variant="text" intent="danger" size="small" onClick={() => { setDeleteTarget(row); setDeleteOpen(true); }}>削除</AppButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Box>

      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' } }}>
        {rows.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>設定なし</Box>
        ) : (
          rows.map((row) => (
            <Box
              key={row.id}
              sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ fontWeight: 'bold' }}>{row.name}</Box>
                  {row.is_unpaid && <Chip size="small" label="無給" color="warning" variant="outlined" />}
                </Stack>
                <SwitchField checked={row.is_active} onChange={() => handleToggleActive(row)} size="small" />
              </Stack>
              <Stack direction="row" spacing={1} mt={1}>
                <AppButton size="small" variant="outlined" intent="secondary" onClick={() => handleEditOpen(row)} sx={{ flex: 1 }}>編集</AppButton>
                <AppButton size="small" variant="outlined" intent="danger" onClick={() => { setDeleteTarget(row); setDeleteOpen(true); }} sx={{ flex: 1 }}>削除</AppButton>
              </Stack>
            </Box>
          ))
        )}
      </Stack>

      <Box mt={2}>
        <AppButton variant="outlined" intent="secondary" size="small" onClick={() => { setAddName(''); setAddUnpaid(false); setAddOpen(true); }} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          役割を追加
        </AppButton>
      </Box>

      <AppDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="xs"
        title="スタッフ役割を編集"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setEditOpen(false)}>キャンセル</AppButton>
            <AppButton onClick={handleEditSave} disabled={saving || !editName.trim()}>
              {saving ? '保存中...' : '保存'}
            </AppButton>
          </>
        )}
      >
        <Stack spacing={2} mt={1}>
          <AppTextField
            label="役割名"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            fullWidth size="small" autoFocus
          />
          <SwitchField
            checked={editUnpaid}
            onChange={(e) => setEditUnpaid(e.target.checked)}
            label="無給（ボランティア・訓練中など）"
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="xs"
        title="スタッフ役割を追加"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setAddOpen(false)}>キャンセル</AppButton>
            <AppButton onClick={handleAddSave} disabled={saving || !addName.trim()}>
              {saving ? '追加中...' : '追加'}
            </AppButton>
          </>
        )}
      >
        <Stack spacing={2} mt={1}>
          <AppTextField
            label="役割名（例：正職員、パート、ボランティア）"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            fullWidth size="small" autoFocus
          />
          <SwitchField
            checked={addUnpaid}
            onChange={(e) => setAddUnpaid(e.target.checked)}
            label="無給（ボランティア・訓練中など）"
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        title="スタッフ役割を削除"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setDeleteOpen(false)}>キャンセル</AppButton>
            <AppButton intent="danger" onClick={handleDeleteConfirm} disabled={saving}>
              {saving ? '削除中...' : '削除'}
            </AppButton>
          </>
        )}
      >
        <Box mt={1}>「{deleteTarget?.name}」を削除しますか？</Box>
      </AppDialog>
    </Box>
  );
}
