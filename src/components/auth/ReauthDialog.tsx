'use client';

import { useState } from 'react';
import { Alert, MenuItem, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField } from '@/components/ui';
import type { ReauthMethod } from '@/utils/reauthTypes';

export const REAUTH_METHOD_LABELS: Record<ReauthMethod, string> = {
  password: 'パスワード', google: 'Google', azure: 'Microsoft',
};

export function ReauthDialog({ methods, method, loading, error, onMethodChange, onSubmit, onCancel }: {
  methods: ReauthMethod[]; method: ReauthMethod; loading: boolean; error: string | null;
  onMethodChange: (method: ReauthMethod) => void;
  onSubmit: (password: string) => Promise<void>; onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const cancel = () => { setPassword(''); onCancel(); };
  const submit = async () => {
    const value = password;
    setPassword('');
    try { await onSubmit(value); } finally { setPassword(''); }
  };
  return <AppDialog open title="本人確認" onClose={cancel} loading={loading} preventCloseWhileLoading={false}
    actions={<>
      <AppButton intent="secondary" variant="text" onClick={cancel}>キャンセル</AppButton>
      <AppButton onClick={() => void submit()} disabled={loading || methods.length === 0 || (method === 'password' && !password)}>
        {method === 'password' ? '本人確認する' : `${REAUTH_METHOD_LABELS[method]}で本人確認`}
      </AppButton>
    </>}>
    <Stack spacing={2}>
      <Typography>重要な操作を続けるため、CareRecordのログイン方法で本人確認してください。</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {methods.length > 1 && <AppTextField select label="本人確認の方法" value={method} disabled={loading}
        onChange={event => { setPassword(''); onMethodChange(event.target.value as ReauthMethod); }}>
        {methods.map(value => <MenuItem key={value} value={value}>{REAUTH_METHOD_LABELS[value]}</MenuItem>)}
      </AppTextField>}
      {methods.includes(method) && (method === 'password'
        ? <form onSubmit={event => { event.preventDefault(); if (!loading && password) void submit(); }}>
          <AppTextField label="現在のパスワード" name="password" type="password" autoComplete="current-password"
            autoFocus value={password} disabled={loading} onChange={event => setPassword(event.target.value)} />
        </form>
        : <Alert severity="info">{REAUTH_METHOD_LABELS[method]}の画面に移動します。現在のCareRecordアカウントと同じアカウントを選んでください。</Alert>)}
    </Stack>
  </AppDialog>;
}
