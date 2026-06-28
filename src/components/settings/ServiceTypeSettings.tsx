'use client';

import { useEffect, useState } from 'react';
import {
  Box, Stack, Switch, Button, CircularProgress, Alert,
  Table, TableBody, TableCell, TableHead, TableRow, TextField,
} from '@/components/ui/mui';
import { AppDialog } from '@/components/ui';
import {
  getServiceTypes, createServiceType, updateServiceType, deleteServiceType,
  type ServiceType,
} from '@/app/actions/serviceTypes';

export default function ServiceTypeSettings({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<ServiceType | null>(null);
  const [editName, setEditName] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ServiceType | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getServiceTypes(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleActive = async (row: ServiceType) => {
    try {
      await updateServiceType(orgId, row.id, { is_active: !row.is_active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  const handleEditOpen = (row: ServiceType) => {
    setEditTarget(row);
    setEditName(row.name);
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget || !editName.trim()) return;
    setSaving(true);
    try {
      await updateServiceType(orgId, editTarget.id, { name: editName.trim() });
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
      await createServiceType(orgId, addName.trim());
      setAddOpen(false);
      setAddName('');
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
      await deleteServiceType(orgId, deleteTarget.id);
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
        <Table size="small" sx={{ minWidth: 400 }}>
          <TableHead>
            <TableRow>
              <TableCell>種別名</TableCell>
              <TableCell>有効</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={3} align="center">設定なし</TableCell></TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell sx={{ minWidth: 160 }}>{row.name}</TableCell>
                  <TableCell>
                    <Switch checked={row.is_active} onChange={() => handleToggleActive(row)} size="small" />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => handleEditOpen(row)}>編集</Button>
                      <Button size="small" color="error" onClick={() => { setDeleteTarget(row); setDeleteOpen(true); }}>削除</Button>
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
                <Box sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{row.name}</Box>
                <Switch checked={row.is_active} onChange={() => handleToggleActive(row)} size="small" />
              </Stack>
              <Stack direction="row" spacing={1} mt={1}>
                <Button size="small" variant="outlined" onClick={() => handleEditOpen(row)} sx={{ flex: 1 }}>編集</Button>
                <Button size="small" variant="outlined" color="error" onClick={() => { setDeleteTarget(row); setDeleteOpen(true); }} sx={{ flex: 1 }}>削除</Button>
              </Stack>
            </Box>
          ))
        )}
      </Stack>

      <Box mt={2}>
        <Button variant="outlined" size="small" onClick={() => { setAddName(''); setAddOpen(true); }} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          種別を追加
        </Button>
      </Box>

      <AppDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="xs"
        title="サービス種別を編集"
        actions={(
          <>
            <Button onClick={() => setEditOpen(false)}>キャンセル</Button>
            <Button variant="contained" onClick={handleEditSave} disabled={saving || !editName.trim()}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </>
        )}
      >
        <Stack spacing={2} mt={1}>
          <TextField
            label="種別名"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            fullWidth size="small" autoFocus
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="xs"
        title="サービス種別を追加"
        actions={(
          <>
            <Button onClick={() => setAddOpen(false)}>キャンセル</Button>
            <Button variant="contained" onClick={handleAddSave} disabled={saving || !addName.trim()}>
              {saving ? '追加中...' : '追加'}
            </Button>
          </>
        )}
      >
        <Stack spacing={2} mt={1}>
          <TextField
            label="種別名（例：重度訪問介護、移動支援）"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            fullWidth size="small" autoFocus
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        title="サービス種別を削除"
        actions={(
          <>
            <Button onClick={() => setDeleteOpen(false)}>キャンセル</Button>
            <Button variant="contained" color="error" onClick={handleDeleteConfirm} disabled={saving}>
              {saving ? '削除中...' : '削除'}
            </Button>
          </>
        )}
      >
        <Box mt={1}>「{deleteTarget?.name}」を削除しますか？この種別に紐づいた区間データには影響しません。</Box>
      </AppDialog>
    </Box>
  );
}
