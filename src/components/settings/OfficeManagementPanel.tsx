'use client';

import { useEffect, useState } from 'react';
import {
  Box, Stack, CircularProgress, Alert,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, NumberField } from '@/components/ui';
import {
  getOffices, createOffice, updateOffice, archiveOffice,
  type Office,
} from '@/app/actions/offices';

export default function OfficeManagementPanel({
  orgId,
  initialOffices,
}: {
  orgId: string;
  initialOffices?: Office[];
}) {
  const [rows, setRows] = useState<Office[]>(initialOffices ?? []);
  const [loading, setLoading] = useState(initialOffices === undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Office | null>(null);
  const [editName, setEditName] = useState('');
  const [editRate, setEditRate] = useState('20');
  const [editOpen, setEditOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addRate, setAddRate] = useState('20');

  const [archiveTarget, setArchiveTarget] = useState<Office | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getOffices(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialOffices !== undefined) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const handleEditOpen = (row: Office) => {
    setEditTarget(row);
    setEditName(row.name);
    setEditRate(String(row.travel_cost_rate_yen_per_km));
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget || !editName.trim()) return;
    setSaving(true);
    try {
      await updateOffice(orgId, editTarget.id, { name: editName.trim(), travel_cost_rate_yen_per_km: Number(editRate) });
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
      await createOffice(orgId, addName.trim(), Number(addRate));
      setAddOpen(false);
      setAddName('');
      setAddRate('20');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await archiveOffice(orgId, archiveTarget.id);
      setArchiveOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アーカイブに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box py={3} textAlign="center"><CircularProgress size={24} /></Box>;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Table size="small" sx={{ minWidth: 360 }}>
        <TableHead>
          <TableRow>
            <TableCell>事業所名</TableCell>
            <TableCell>交通費単価(円/km)</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={3} align="center">事業所が登録されていません</TableCell></TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell sx={{ minWidth: 140 }}>{row.name}</TableCell>
                <TableCell>{row.travel_cost_rate_yen_per_km.toLocaleString()}円/km</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1}>
                    <AppButton variant="text" intent="secondary" size="small" onClick={() => handleEditOpen(row)}>編集</AppButton>
                    <AppButton variant="text" intent="danger" size="small" onClick={() => { setArchiveTarget(row); setArchiveOpen(true); }}>アーカイブ</AppButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Box mt={2}>
        <AppButton variant="outlined" intent="secondary" size="small" onClick={() => { setAddName(''); setAddRate('20'); setAddOpen(true); }}>
          事業所を追加
        </AppButton>
      </Box>

      <AppDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="xs"
        title="事業所を編集"
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
          <AppTextField label="事業所名" value={editName} onChange={(e) => setEditName(e.target.value)} fullWidth size="small" autoFocus />
          <NumberField
            label="1kmあたり単価"
            value={editRate}
            onChange={(e) => setEditRate(e.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', step: '1', min: 0 } }}
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="xs"
        title="事業所を追加"
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
          <AppTextField label="事業所名" value={addName} onChange={(e) => setAddName(e.target.value)} fullWidth size="small" autoFocus />
          <NumberField
            label="1kmあたり単価"
            value={addRate}
            onChange={(e) => setAddRate(e.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', step: '1', min: 0 } }}
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        maxWidth="xs"
        title="事業所をアーカイブ"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setArchiveOpen(false)}>キャンセル</AppButton>
            <AppButton intent="danger" onClick={handleArchiveConfirm} disabled={saving}>
              {saving ? '処理中...' : 'アーカイブ'}
            </AppButton>
          </>
        )}
      >
        <Box mt={1}>「{archiveTarget?.name}」をアーカイブしますか？所属中のスタッフ・利用者がいる場合は先に所属を変更してください。</Box>
      </AppDialog>
    </Box>
  );
}
