'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppTextField } from '@/components/ui';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getMcpShiftReadControl, setMcpShiftReadControl } from '@/app/actions/mcpShiftReadControl';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

const fields = [
  ['provider', 'AI提供先'], ['processing', 'データ処理条件'], ['region', '保存地域'],
  ['retention', '保存期間・ログ保持'], ['secondary_use', '二次利用'], ['notice', '利用者への説明'],
] as const;
type Field = typeof fields[number][0];
const emptyConditions: Record<Field, string> = { provider: '', processing: '', region: '', retention: '', secondary_use: '', notice: '' };

export function McpShiftReadSettings({ organizationId }: { organizationId: string }) {
  return <McpShiftReadSettingsForOrg key={organizationId} organizationId={organizationId} />;
}

function McpShiftReadSettingsForOrg({ organizationId }: { organizationId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [conditions, setConditions] = useState(emptyConditions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();

  useEffect(() => {
    let active = true;
    void readActionResult(getMcpShiftReadControl(organizationId)).then(result => {
      if (!active) return;
      setEnabled(result.enabled);
      if (result.conditions) setConditions(result.conditions);
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId]);

  async function change(next: boolean) {
    if (next && fields.some(([key]) => !conditions[key].trim() || conditions[key].length > 500)) {
      showToast('すべての確認項目を入力してください', 'error');
      return;
    }
    const accepted = await confirm({
      message: next
        ? '確認項目の内容と根拠を確認し、この事業所のAIシフト参照を有効にしますか？ 外部AIへの情報提供は利用するサービスの条件にも従います。'
        : 'この事業所のAIシフト参照を停止しますか？ 既存のシフトは変更されません。',
      confirmText: next ? '確認して有効にする' : '停止する',
      confirmColor: next ? 'primary' : 'warning',
    });
    if (!accepted) return;
    setSaving(true);
    try {
      await readActionResult(setMcpShiftReadControl(organizationId, next, conditions, true));
      setEnabled(next);
      showToast(next ? 'AIシフト参照を有効にしました' : 'AIシフト参照を停止しました', 'success');
    } catch (error) { showToast(getActionErrorMessage(error), 'error'); }
    finally { setSaving(false); }
  }

  return <Box sx={{ mt: 3, p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
    <Typography variant="h6" fontWeight="bold" gutterBottom>AIアプリからのシフト参照</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>AIアプリに権限内のシフト・担当者情報を提供します。事業所ごとに提供条件を確認してから有効にしてください。確認結果と根拠には個人情報や秘密情報を入力しないでください。</Typography>
    {loading ? <CircularProgress size={24} /> : loadError || enabled === null ? <Alert severity="error">設定を取得できませんでした。再読み込みしてください。</Alert> : <Stack spacing={2}>
      <Alert severity={enabled ? 'success' : 'info'}>事業所の設定: {enabled ? '有効' : '停止中'}。環境全体の設定によっては利用できない場合があります。停止しても既存のシフトは保持されます。</Alert>
      {fields.map(([key, label]) => <AppTextField key={key} label={`${label}の確認結果・根拠`} value={conditions[key]} onChange={event => setConditions({ ...conditions, [key]: event.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} disabled={saving} multiline />)}
      <Box><AppButton onClick={() => void change(!enabled)} disabled={saving} intent={enabled ? 'warning' : 'primary'}>{enabled ? 'AIシフト参照を停止' : '確認して有効化'}</AppButton></Box>
    </Stack>}
  </Box>;
}
