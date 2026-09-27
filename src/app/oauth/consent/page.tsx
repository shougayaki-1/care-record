import { redirect } from 'next/navigation';
import { Alert, Box, Button, Container, Divider, Paper, Stack, Typography } from '@/components/ui/mui';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { decideMcpAuthorization } from './actions';

export const dynamic = 'force-dynamic';

function ConsentMessage({ children }: { children: React.ReactNode }) {
  return <Box component="main" sx={{ height: '100dvh', overflowY: 'auto', bgcolor: 'background.default', py: { xs: 4, sm: 8 }, px: 2 }}>
    <Container maxWidth="sm"><Alert severity="warning">{children}</Alert></Container>
  </Box>;
}

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!authorizationId || !/^[a-zA-Z0-9_-]{1,512}$/.test(authorizationId)) {
    return <ConsentMessage>接続リクエストが見つかりません。</ConsentMessage>;
  }

  try {
    await getAuthedUser();
  } catch {
    redirect(`/?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return <ConsentMessage>接続リクエストを確認できませんでした。最初から接続をやり直してください。</ConsentMessage>;
  }
  if (!('authorization_id' in data)) redirect(data.redirect_url);

  return (
    <Box component="main" sx={{ height: '100dvh', overflowY: 'auto', bgcolor: 'background.default', py: { xs: 4, sm: 8 }, px: 2 }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 2 }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h5" component="h1" fontWeight="bold" gutterBottom>AIアプリとの接続を確認</Typography>
              <Typography color="text.secondary">{data.client.name} が CareRecord の読み取り候補機能に接続しようとしています。</Typography>
            </Box>
            <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle2">接続先</Typography>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 2 }}>{data.redirect_uri}</Typography>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2">要求された権限</Typography>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{data.scope?.trim() || '基本的な接続'}</Typography>
            </Box>
            <Alert severity="info">
              接続したAIは、所属事業所とフォームを確認し、PDFの読み取り結果を「要確認の候補」として送信できます。
              記録の確定はアプリで原本を確認した後に行います。PDFや画像をAIへ添付すると、そのデータは接続先のAIサービスに送られます。
              接続はアカウント設定の「AIアプリとの接続」から解除できます。
            </Alert>
            <Box component="form" action={decideMcpAuthorization} sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <input type="hidden" name="authorization_id" value={authorizationId} />
              <Button type="submit" name="decision" value="deny" variant="outlined">許可しない</Button>
              <Button type="submit" name="decision" value="approve" variant="contained">接続を許可</Button>
            </Box>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
