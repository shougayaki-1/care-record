'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

type Grant = { client: { id: string; name: string; uri: string }; scopes: string[]; granted_at: string };

export default function AiConnectionsPage() {
  const confirm = useConfirm();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyClient, setBusyClient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.oauth.listGrants().then((result) => {
      if (!active) return;
      setError(result.error ? '接続一覧を取得できませんでした' : null);
      setGrants((result.data ?? []) as Grant[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const revoke = async (grant: Grant) => {
    const approved = await confirm({ message: `${grant.client.name} との接続を解除しますか？` });
    if (!approved) return;
    setBusyClient(grant.client.id);
    const result = await supabase.auth.oauth.revokeGrant({ clientId: grant.client.id });
    if (result.error) setError('接続を解除できませんでした');
    else {
      const refreshed = await supabase.auth.oauth.listGrants();
      setError(refreshed.error ? '接続一覧を更新できませんでした' : null);
      if (!refreshed.error) setGrants((refreshed.data ?? []) as Grant[]);
    }
    setBusyClient(null);
  };

  return <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 760 }}>
    <Stack spacing={2}>
      <Typography variant="h5" fontWeight="bold">AIアプリとの接続</Typography>
      <Button component={Link} href="/app/profile" variant="text" sx={{ alignSelf: 'flex-start' }}>アカウント設定に戻る</Button>
      <Alert severity="info">接続したAIアプリは、所属事業所とフォームを参照し、読み取り候補を送信できます。紙やPDFは接続先のAIサービスへ渡されます。接続を解除すると再認証はできなくなりますが、発行済みアクセストークンは有効期限まで使える場合があります。</Alert>
      {error && <Alert severity="error">{error}</Alert>}
      {loading ? <CircularProgress /> : grants.length === 0 ? <Alert severity="info">接続中のAIアプリはありません。</Alert> : grants.map((grant) => (
        <Box key={grant.client.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
            <Box>
              <Typography fontWeight="bold">{grant.client.name}</Typography>
              <Typography variant="body2" color="text.secondary">接続日: {new Date(grant.granted_at).toLocaleDateString('ja-JP')}</Typography>
            </Box>
            <Button color="error" variant="outlined" disabled={busyClient === grant.client.id} onClick={() => void revoke(grant)}>接続を解除</Button>
          </Stack>
        </Box>
      ))}
    </Stack>
  </Box>;
}
