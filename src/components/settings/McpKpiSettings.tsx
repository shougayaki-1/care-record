'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppTextField } from '@/components/ui';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getMcpKpiControl, setMcpKpiControl } from '@/app/actions/mcpKpiControl';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

const fields = [
  ['provider', 'AI提供先'], ['processing', 'データ処理条件'], ['region', '保存地域'],
  ['retention', '保存期間・ログ保持'], ['secondary_use', '二次利用'], ['notice', '利用者への説明'],
] as const;
type Field = typeof fields[number][0];
const emptyConditions: Record<Field, string> = { provider: '', processing: '', region: '', retention: '', secondary_use: '', notice: '' };

export function McpKpiSettings({ organizationId }: { organizationId: string }) {
  return <McpKpiSettingsForOrg key={organizationId} organizationId={organizationId} />;
}

function McpKpiSettingsForOrg({ organizationId }: { organizationId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [conditions, setConditions] = useState(emptyConditions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();

  useEffect(() => {
    let active = true;
    void readActionResult(getMcpKpiControl(organizationId)).then(result => {
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
        ? '確認項目の内容と根拠を確認し、この事業所のAI集計参照を有効にしますか？ 外部AIへの情報提供は利用するサービスの条件にも従います。'
        : 'この事業所のAI集計参照を停止しますか？ 既存の記録は変更されません。',
      confirmText: next ? '確認して有効にする' : '停止する',
      confirmColor: next ? 'primary' : 'warning',
    });
    if (!accepted) return;
    setSaving(true);
    try {
      await readActionResult(setMcpKpiControl(organizationId, next, conditions, true));
      setEnabled(next);
      showToast(next ? 'AI集計参照を有効にしました' : 'AI集計参照を停止しました', 'success');
    } catch (error) { showToast(getActionErrorMessage(error), 'error'); }
    finally { setSaving(false); }
  }

  return <Box sx={{ mt: 3, p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
    <Typography variant="h6" fontWeight="bold" gutterBottom>AIアプリからの集計参照</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>集計にはシフト・提供記録・内勤が含まれます。事業所ごとに提供条件を確認してから有効にします。直接 RPC による取得では氏名や記録本文を含まない個別の時刻・状態・時間も提供されるため、その取扱いも確認してください。確認結果と根拠には個人情報や秘密情報を入力しないでください。</Typography>
    {loading ? <CircularProgress size={24} /> : loadError || enabled === null ? <Alert severity="error">設定を取得できませんでした。再読み込みしてください。</Alert> : <Stack spacing={2}>
      <Alert severity={enabled ? 'success' : 'info'}>事業所の設定: {enabled ? '有効' : '停止中'}。環境全体の設定によっては利用できない場合があります。記録参照とシフト参照も別途有効である必要があります。</Alert>
      {fields.map(([key, label]) => <AppTextField key={key} label={`${label}の確認結果・根拠`} value={conditions[key]} onChange={event => setConditions({ ...conditions, [key]: event.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} disabled={saving} multiline />)}
      <Box><AppButton onClick={() => void change(!enabled)} disabled={saving} intent={enabled ? 'warning' : 'primary'}>{enabled ? 'AI集計参照を停止' : '確認して有効化'}</AppButton></Box>
    </Stack>}
  </Box>;
}
