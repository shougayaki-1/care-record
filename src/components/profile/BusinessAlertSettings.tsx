'use client';
import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, CheckboxGroupField, RadioGroupField, SwitchField } from '@/components/ui';
import { getBusinessAlertPreferences, setBusinessAlertPreferences } from '@/app/actions/mcpBusinessAlerts';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

const categories = [{ value: 'pending_reports', label: '未承認の記録' }, { value: 'unassigned_shifts', label: '未割当のシフト' }] as const;
const frequencies = [{ value: 'daily', label: '毎日' }, { value: 'weekly', label: '毎週' }] as const;
type Preferences = Awaited<ReturnType<typeof readPreferences>>;
async function readPreferences(org: string) { return readActionResult(getBusinessAlertPreferences(org)); }
export function BusinessAlertSettings({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  return <Settings key={organizationId} organizationId={organizationId} organizationName={organizationName} />;
}
function Settings({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [value, setValue] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void readPreferences(organizationId).then(result => { if (active) setValue(result); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); });
    return () => { active = false; };
  }, [organizationId]);
  async function save() {
    if (!value) return;
    setError(null); setSuccess(false); setSaving(true);
    try { setValue(await readActionResult(setBusinessAlertPreferences(organizationId, value))); setSuccess(true); }
    catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  return <Box component="section" aria-label="業務通知の設定" sx={{ p: 4, borderRadius: 1 }}><Stack spacing={2}>
    <Typography variant="h6">業務通知の設定</Typography>
    <Typography>事業所: {organizationName}。あなたのアプリ内通知に、権限のある確認待ちだけを届けます。個別の利用者名や記録本文は通知に含みません。</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {success && <Alert severity="success">通知設定を保存しました。</Alert>}
    {!value ? (!error && <CircularProgress aria-label="通知設定を読み込み中" />) : <>
      <SwitchField label="業務通知を受け取る" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} />
      <RadioGroupField label="通知頻度" options={frequencies} value={value.frequency} onChange={frequency => setValue({ ...value, frequency: frequency === 'weekly' ? 'weekly' : 'daily' })} getOptionLabel={option => option.label} getOptionValue={option => option.value} />
      <CheckboxGroupField label="通知する内容" options={categories} value={categories.filter(option => value[option.value]).map(option => option.value)} onChange={selected => setValue({ ...value, pending_reports: selected.includes('pending_reports'), unassigned_shifts: selected.includes('unassigned_shifts') })} getOptionLabel={option => option.label} getOptionValue={option => option.value} row={false} />
      <Typography variant="body2">未承認の記録は記録承認権限、未割当は事業所全体のシフト閲覧権限が必要です。配信は事業所の運用設定にも依存します。</Typography>
      <Box><AppButton onClick={() => void save()} loading={saving}>通知設定を保存</AppButton></Box>
    </>}
  </Stack></Box>;
}
