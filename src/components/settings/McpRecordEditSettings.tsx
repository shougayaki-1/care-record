'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppTextField } from '@/components/ui';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getMcpRecordEditControl, setMcpRecordEditControl } from '@/app/actions/mcpRecordEditControl';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

const fields = [
  ['provider', 'AI提供先'], ['processing', 'データ処理条件'], ['region', '保存地域'],
  ['retention', '保存期間・ログ保持'], ['secondary_use', '二次利用'], ['notice', '利用者への説明'],
] as const;
type Field = typeof fields[number][0];
const emptyConditions: Record<Field, string> = { provider: '', processing: '', region: '', retention: '', secondary_use: '', notice: '' };

export function McpRecordEditSettings({ organizationId }: { organizationId: string }) {
  return <McpRecordEditSettingsForOrg key={organizationId} organizationId={organizationId} />;
}

function McpRecordEditSettingsForOrg({ organizationId }: { organizationId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [conditions, setConditions] = useState(emptyConditions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();

  useEffect(() => {
    let active = true;
    void readActionResult(getMcpRecordEditControl(organizationId)).then(result => {
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
        ? '確認項目の内容と根拠を確認し、この事業所のAI記録変更を有効にしますか？ 外部AIへの情報提供は利用するサービスの条件にも従います。'
        : 'この事業所のAI記録変更を停止しますか？ 既存の記録は変更されません。',
      confirmText: next ? '確認して有効にする' : '停止する',
      confirmColor: next ? 'primary' : 'warning',
    });
    if (!accepted) return;
    setSaving(true);
    try {
      await readActionResult(setMcpRecordEditControl(organizationId, next, conditions, true));
      setEnabled(next);
      showToast(next ? 'AI記録変更を有効にしました' : 'AI記録変更を停止しました', 'success');
    } catch (error) { showToast(getActionErrorMessage(error), 'error'); }
    finally { setSaving(false); }
  }

  return <Box sx={{ mt: 3, p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
    <Typography variant="h6" fontWeight="bold" gutterBottom>AIアプリからの記録変更</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>AIアプリに提供記録の情報を提供します。下書きは本人が画面で内容を確認した後に保存します。承認済みの記録は変更せず訂正案として保存します。事業所ごとに提供条件を確認してから有効にしてください。確認結果と根拠には個人情報や秘密情報を入力しないでください。</Typography>
    {loading ? <CircularProgress size={24} /> : loadError || enabled === null ? <Alert severity="error">設定を取得できませんでした。再読み込みしてください。</Alert> : <Stack spacing={2}>
      <Alert severity={enabled ? 'success' : 'info'}>事業所の設定: {enabled ? '有効' : '停止中'}。環境全体の設定によっては利用できない場合があります。記録参照も別途有効である必要があります。</Alert>
      {fields.map(([key, label]) => <AppTextField key={key} label={`${label}の確認結果・根拠`} value={conditions[key]} onChange={event => setConditions({ ...conditions, [key]: event.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} disabled={saving} multiline />)}
      <Box><AppButton onClick={() => void change(!enabled)} disabled={saving} intent={enabled ? 'warning' : 'primary'}>{enabled ? 'AI記録変更を停止' : '確認して有効化'}</AppButton></Box>
    </Stack>}
  </Box>;
}
