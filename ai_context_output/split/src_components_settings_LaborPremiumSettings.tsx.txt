'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Box, Stack, Chip, CircularProgress, Alert,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, NumberField, SelectField, SwitchField } from '@/components/ui';
import { getLaborPremiumTypes, updateLaborPremiumType, createLaborPremiumType, disableLaborPremiumType } from '@/app/actions/laborPremium';
import type { LaborPremiumType } from '@/utils/laborPremium';

type PremiumRow = LaborPremiumType & { display_order: number };

interface EditState {
  name: string;
  ratePercent: string; // shown as %, stored as decimal on save
  calc_method: 'additive' | 'multiplicative';
  night_start_hour: string;
  night_end_hour: string;
  overtime_daily_threshold_hours: string;
  overtime_weekly_threshold_hours: string;
  variable_working_hours_enabled: boolean;
  variable_overtime_period: 'week' | 'month';
  variable_overtime_threshold_hours: string;
}

const defaultEditState = (): EditState => ({
  name: '',
  ratePercent: '25',
  calc_method: 'additive',
  night_start_hour: '22',
  night_end_hour: '5',
  overtime_daily_threshold_hours: '8',
  overtime_weekly_threshold_hours: '40',
  variable_working_hours_enabled: false,
  variable_overtime_period: 'month',
  variable_overtime_threshold_hours: '160',
});

function rowToEditState(row: PremiumRow): EditState {
  return {
    name: row.name,
    ratePercent: String(Math.round(row.rate * 100)),
    calc_method: row.calc_method,
    night_start_hour: row.night_start_hour != null ? String(row.night_start_hour) : '22',
    night_end_hour: row.night_end_hour != null ? String(row.night_end_hour) : '5',
    overtime_daily_threshold_hours: row.overtime_daily_threshold_hours != null ? String(row.overtime_daily_threshold_hours) : '8',
    overtime_weekly_threshold_hours: row.overtime_weekly_threshold_hours != null ? String(row.overtime_weekly_threshold_hours) : '40',
    variable_working_hours_enabled: Boolean(row.variable_working_hours_enabled),
    variable_overtime_period: row.variable_overtime_period === 'week' ? 'week' : 'month',
    variable_overtime_threshold_hours: row.variable_overtime_threshold_hours != null ? String(row.variable_overtime_threshold_hours) : '160',
  };
}

export default function LaborPremiumSettings({
  orgId,
  initialLaborPremiumTypes,
}: {
  orgId: string;
  initialLaborPremiumTypes?: LaborPremiumType[];
}) {
  const [rows, setRows] = useState<PremiumRow[]>((initialLaborPremiumTypes as PremiumRow[]) ?? []);
  const [loading, setLoading] = useState(initialLaborPremiumTypes === undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit dialog
  const [editTarget, setEditTarget] = useState<PremiumRow | null>(null);
  const [editState, setEditState] = useState<EditState>(defaultEditState());
  const [editOpen, setEditOpen] = useState(false);

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addState, setAddState] = useState<EditState>(defaultEditState());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLaborPremiumTypes(orgId);
      setRows(data as PremiumRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (initialLaborPremiumTypes !== undefined) return;
    queueMicrotask(() => void load());
  }, [initialLaborPremiumTypes, load]);

  const handleToggleEnabled = async (row: PremiumRow) => {
    try {
      if (row.is_enabled) {
        await disableLaborPremiumType(orgId, row.id);
      } else {
        await updateLaborPremiumType(orgId, row.id, { is_enabled: true });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  const handleEditOpen = (row: PremiumRow) => {
    setEditTarget(row);
    setEditState(rowToEditState(row));
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const patch: Parameters<typeof updateLaborPremiumType>[2] = {
        name: editState.name,
        rate: parseFloat(editState.ratePercent) / 100,
        calc_method: editState.calc_method,
      };
      if (editTarget.builtin_type === 'night' || editTarget.builtin_type === 'custom') {
        patch.night_start_hour = parseInt(editState.night_start_hour);
        patch.night_end_hour = parseInt(editState.night_end_hour);
      }
      if (editTarget.builtin_type === 'overtime') {
        patch.overtime_daily_threshold_hours = parseFloat(editState.overtime_daily_threshold_hours);
        patch.overtime_weekly_threshold_hours = parseFloat(editState.overtime_weekly_threshold_hours);
        patch.variable_working_hours_enabled = editState.variable_working_hours_enabled;
        patch.variable_overtime_period = editState.variable_working_hours_enabled ? editState.variable_overtime_period : null;
        patch.variable_overtime_threshold_hours = editState.variable_working_hours_enabled
          ? parseFloat(editState.variable_overtime_threshold_hours)
          : null;
      }
      await updateLaborPremiumType(orgId, editTarget.id, patch);
      setEditOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSave = async () => {
    setSaving(true);
    try {
      await createLaborPremiumType(orgId, {
        name: addState.name,
        rate: parseFloat(addState.ratePercent) / 100,
        calc_method: addState.calc_method,
        night_start_hour: parseInt(addState.night_start_hour),
        night_end_hour: parseInt(addState.night_end_hour),
      });
      setAddOpen(false);
      setAddState(defaultEditState());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const calcMethodLabel = (m: string) => m === 'additive' ? '加算' : '乗算';
  const overtimeRuleLabel = (row: PremiumRow) => {
    if (row.builtin_type !== 'overtime') return null;
    if (row.variable_working_hours_enabled && row.variable_overtime_threshold_hours != null) {
      const period = row.variable_overtime_period === 'week' ? '週' : '月';
      return `変形労働: ${period}${row.variable_overtime_threshold_hours}h超`;
    }
    const daily = row.overtime_daily_threshold_hours != null ? `日${row.overtime_daily_threshold_hours}h超` : null;
    const weekly = row.overtime_weekly_threshold_hours != null ? `週${row.overtime_weekly_threshold_hours}h超` : null;
    return [daily, weekly].filter(Boolean).join(' / ') || null;
  };

  if (loading) return <Box py={3} textAlign="center"><CircularProgress size={24} /></Box>;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 520 }}>
          <TableHead>
            <TableRow>
              <TableCell>種別名</TableCell>
              <TableCell align="right">率</TableCell>
              <TableCell>計算方法</TableCell>
              <TableCell>加算対象</TableCell>
              <TableCell>有効</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} align="center">設定なし</TableCell></TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell sx={{ minWidth: 140 }}>{row.name}</TableCell>
                  <TableCell align="right">{Math.round(row.rate * 100)}%</TableCell>
                  <TableCell>
                    <Chip size="small" label={calcMethodLabel(row.calc_method)} />
                  </TableCell>
                  <TableCell>
                    {overtimeRuleLabel(row) ? (
                      <Chip size="small" label={overtimeRuleLabel(row)} variant="outlined" />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <SwitchField
                      checked={row.is_enabled}
                      onChange={() => handleToggleEnabled(row)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <AppButton variant="text" intent="secondary" size="small" onClick={() => handleEditOpen(row)}>編集</AppButton>
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
              sx={{
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
              }}
            >
              <Stack spacing={1.25}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{row.name}</Box>
                    <Stack direction="row" spacing={1} alignItems="center" mt={0.75}>
                      <Chip size="small" label={`${Math.round(row.rate * 100)}%`} color="primary" variant="outlined" />
                      <Chip size="small" label={calcMethodLabel(row.calc_method)} />
                      {overtimeRuleLabel(row) && <Chip size="small" label={overtimeRuleLabel(row)} variant="outlined" />}
                    </Stack>
                  </Box>
                  <SwitchField
                    checked={row.is_enabled}
                    onChange={() => handleToggleEnabled(row)}
                    size="small"
                  />
                </Stack>
                <AppButton size="small" variant="outlined" intent="secondary" onClick={() => handleEditOpen(row)} sx={{ alignSelf: 'stretch' }}>
                  編集
                </AppButton>
              </Stack>
            </Box>
          ))
        )}
      </Stack>

      <Box mt={2}>
        <AppButton variant="outlined" intent="secondary" size="small" onClick={() => { setAddState(defaultEditState()); setAddOpen(true); }} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          種別を追加
        </AppButton>
      </Box>

      {/* Edit Dialog */}
      <AppDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="xs"
        title="割り増し種別を編集"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setEditOpen(false)}>キャンセル</AppButton>
            <AppButton onClick={handleEditSave} disabled={saving || !editState.name}>
              {saving ? '保存中...' : '保存'}
            </AppButton>
          </>
        )}
      >
          <Stack spacing={2} mt={1}>
            <AppTextField
              label="種別名"
              value={editState.name}
              onChange={(e) => setEditState(s => ({ ...s, name: e.target.value }))}
              fullWidth size="small"
            />
            <NumberField
              label="割り増し率 (%)"
              value={editState.ratePercent}
              onChange={(e) => setEditState(s => ({ ...s, ratePercent: e.target.value }))}
              fullWidth size="small"
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
            />
            <SelectField
              label="計算方法"
              value={editState.calc_method}
              onChange={(value) => setEditState(s => ({ ...s, calc_method: value as 'additive' | 'multiplicative' }))}
              options={[
                { value: 'additive', label: '加算 (additive)' },
                { value: 'multiplicative', label: '乗算 (multiplicative)' },
              ]}
            />
            {(editTarget?.builtin_type === 'night' || editTarget?.builtin_type === 'custom') && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <NumberField
                  label="深夜開始 (時)"
                  value={editState.night_start_hour}
                  onChange={(e) => setEditState(s => ({ ...s, night_start_hour: e.target.value }))}
                  size="small"
                  slotProps={{ htmlInput: { min: 0, max: 23 } }}
                />
                <NumberField
                  label="深夜終了 (時)"
                  value={editState.night_end_hour}
                  onChange={(e) => setEditState(s => ({ ...s, night_end_hour: e.target.value }))}
                  size="small"
                  slotProps={{ htmlInput: { min: 0, max: 23 } }}
                />
              </Stack>
            )}
            {editTarget?.builtin_type === 'overtime' && (
              <Stack spacing={1.5}>
                <SwitchField
                  checked={editState.variable_working_hours_enabled}
                  onChange={(e) => setEditState(s => ({ ...s, variable_working_hours_enabled: e.target.checked }))}
                  label="変形労働時間制を適用"
                />
                {editState.variable_working_hours_enabled ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <SelectField
                      label="集計期間"
                      value={editState.variable_overtime_period}
                      onChange={(value) => setEditState(s => ({ ...s, variable_overtime_period: value as 'week' | 'month' }))}
                      options={[
                        { value: 'week', label: '週単位' },
                        { value: 'month', label: '月単位' },
                      ]}
                    />
                    <NumberField
                      label="期間内の加算対象 (h超)"
                      value={editState.variable_overtime_threshold_hours}
                      onChange={(e) => setEditState(s => ({ ...s, variable_overtime_threshold_hours: e.target.value }))}
                      size="small"
                      slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
                    />
                  </Stack>
                ) : (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <NumberField
                      label="日次閾値 (h)"
                      value={editState.overtime_daily_threshold_hours}
                      onChange={(e) => setEditState(s => ({ ...s, overtime_daily_threshold_hours: e.target.value }))}
                      size="small"
                      slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
                    />
                    <NumberField
                      label="週次閾値 (h)"
                      value={editState.overtime_weekly_threshold_hours}
                      onChange={(e) => setEditState(s => ({ ...s, overtime_weekly_threshold_hours: e.target.value }))}
                      size="small"
                      slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    />
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
      </AppDialog>

      {/* Add Dialog */}
      <AppDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="xs"
        title="割り増し種別を追加"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setAddOpen(false)}>キャンセル</AppButton>
            <AppButton onClick={handleAddSave} disabled={saving || !addState.name}>
              {saving ? '追加中...' : '追加'}
            </AppButton>
          </>
        )}
      >
          <Stack spacing={2} mt={1}>
            <AppTextField
              label="種別名"
              value={addState.name}
              onChange={(e) => setAddState(s => ({ ...s, name: e.target.value }))}
              fullWidth size="small"
            />
            <NumberField
              label="割り増し率 (%)"
              value={addState.ratePercent}
              onChange={(e) => setAddState(s => ({ ...s, ratePercent: e.target.value }))}
              fullWidth size="small"
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
            />
            <SelectField
              label="計算方法"
              value={addState.calc_method}
              onChange={(value) => setAddState(s => ({ ...s, calc_method: value as 'additive' | 'multiplicative' }))}
              options={[
                { value: 'additive', label: '加算 (additive)' },
                { value: 'multiplicative', label: '乗算 (multiplicative)' },
              ]}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <NumberField
                label="深夜開始 (時)"
                value={addState.night_start_hour}
                onChange={(e) => setAddState(s => ({ ...s, night_start_hour: e.target.value }))}
                size="small"
                slotProps={{ htmlInput: { min: 0, max: 23 } }}
              />
              <NumberField
                label="深夜終了 (時)"
                value={addState.night_end_hour}
                onChange={(e) => setAddState(s => ({ ...s, night_end_hour: e.target.value }))}
                size="small"
                slotProps={{ htmlInput: { min: 0, max: 23 } }}
              />
            </Stack>
          </Stack>
      </AppDialog>
    </Box>
  );
}
