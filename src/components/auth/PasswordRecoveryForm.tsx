'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppTextField } from '@/components/ui';
import { requestPasswordReset, finishPasswordReset } from '@/app/actions/authSecurity';
import { PASSWORD_RESET_SENT_MESSAGE } from '@/utils/passwordRecovery';
import { validatePassword, PASSWORD_POLICY_HINT } from '@/utils/passwordPolicy';

export function PasswordRecoveryForm({ mode, validLink = true }: { mode: 'request' | 'reset'; validLink?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || cooldown > 0) return;
    if (mode === 'reset') {
      const policy = validatePassword(password);
      if (!policy.ok) { setMessage({ severity: 'error', text: policy.message }); return; }
      if (password !== confirmation) { setMessage({ severity: 'error', text: 'パスワードが一致しません' }); return; }
    }
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      if (mode === 'request') {
        const result = await requestPasswordReset(email);
        if (!result.ok) throw new Error('メールアドレスを確認してください');
        setMessage({ severity: 'success', text: PASSWORD_RESET_SENT_MESSAGE });
        setCooldown(60);
      } else {
        await finishPasswordReset(password, confirmation);
        setPassword(''); setConfirmation('');
        setMessage({ severity: 'success', text: 'パスワードを再設定しました。ログアウトしてログイン画面に戻ります。' });
        const { logoutCurrentUser } = await import('@/utils/clientLogout');
        try { await logoutCurrentUser(); } finally { window.location.assign(new URL('/', window.location.origin).href); }
      }
    } catch (error) {
      setMessage({ severity: 'error', text: mode === 'request'
        ? '送信処理を完了できませんでした。時間をおいて再度お試しください。'
        : error instanceof Error ? error.message : '再設定できませんでした。新しいリンクを取得してください。' });
    } finally {
      setPassword(''); setConfirmation(''); setBusy(false); inFlight.current = false;
    }
  };
  return <Box sx={{ maxWidth: 440, mx: 'auto', px: 3, py: 6 }}>
    <Stack spacing={3}>
      <Typography variant="h5" component="h1">{mode === 'request' ? 'パスワードを忘れた方' : 'パスワードの再設定'}</Typography>
      {message && <Alert severity={message.severity}>{message.text}</Alert>}
      {mode === 'reset' && !validLink
        ? <Alert severity="error">リンクが無効、または有効期限が切れています。再設定用メールをもう一度取得してください。</Alert>
        : <form onSubmit={submit}><Stack spacing={2}>
          {mode === 'request' ? <>
            <Typography>登録に使用したメールアドレスを入力してください。</Typography>
            <AppTextField label="メールアドレス" name="email" type="email" autoComplete="email" required
              value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
          </> : <>
            <AppTextField label="新しいパスワード" name="new-password" type="password" autoComplete="new-password"
              helperText={PASSWORD_POLICY_HINT} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
            <AppTextField label="新しいパスワード（確認）" name="confirm-password" type="password" autoComplete="new-password"
              required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
          </>}
          <AppButton type="submit" loading={busy} disabled={cooldown > 0}>
            {cooldown > 0 ? `${cooldown}秒後に再送できます` : mode === 'request' ? '再設定用メールを送信' : 'パスワードを再設定'}
          </AppButton>
        </Stack></form>}
      {mode === 'reset' && <AppButton href="/auth/forgot-password" variant="text">再設定用メールを再送する</AppButton>}
      <AppButton href="/" intent="secondary" variant="text">ログイン画面に戻る</AppButton>
    </Stack>
  </Box>;
}
