'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Container, Paper, Stack, Typography } from '@/components/ui/mui';
import { AppButton } from '@/components/ui';
import { useReauth } from '@/hooks/useReauth';
import { consumeStepUpGrantCookie } from '@/app/actions/auth';
import { readActionResult } from '@/utils/actionResult';
import { prepareMcpReauth } from './actions';

export function McpReauth({ authorizationId }: { authorizationId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { requestReauth, reauthDialog } = useReauth();
  const resumed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const stepupFailed = searchParams.has('stepupError');
  const displayedError = error ?? (stepupFailed ? '本人確認を完了できませんでした。' : null);
  const [loading, setLoading] = useState(searchParams.has('stepup') && !stepupFailed);
  const complete = async (token: string) => {
    await readActionResult(prepareMcpReauth(authorizationId, token));
    router.replace(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    router.refresh();
  };
  useEffect(() => {
    if (resumed.current || !searchParams.has('stepup')) return;
    resumed.current = true;
    if (searchParams.has('stepupError')) return;
    void readActionResult(consumeStepUpGrantCookie()).then(grant => {
      if (!grant) throw new Error('missing proof');
      return complete(grant.token);
    }).catch(() => setError('本人確認を完了できませんでした。最初から接続をやり直してください。'))
      .finally(() => setLoading(false));
    // Only consume the short-lived cookie once on return from the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const start = async () => {
    setError(null);
    const grant = await requestReauth('mcp_connection', { next: `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}` });
    if (!grant) return;
    setLoading(true);
    try { await complete(grant.token); } catch { setError('本人確認を完了できませんでした。最初から接続をやり直してください。'); }
    finally { setLoading(false); }
  };
  return <Box component="main" sx={{ height: '100dvh', overflowY: 'auto', bgcolor: 'background.default', py: { xs: 4, sm: 8 }, px: 2 }}>
    <Container maxWidth="sm"><Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 2 }}>
      <Stack spacing={3}>
        <Typography variant="h5" component="h1" fontWeight="bold">AIアプリへの接続</Typography>
        <Typography>接続を続けるには、CareRecordのログイン方法で本人確認してください。</Typography>
        {displayedError && <Alert severity="error">{displayedError}</Alert>}
        <AppButton loading={loading} onClick={() => void start()}>本人確認を始める</AppButton>
      </Stack>
    </Paper></Container>{reauthDialog}
  </Box>;
}
