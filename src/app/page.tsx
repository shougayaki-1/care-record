'use client';

import { useEffect, useState } from 'react';
import { Box, Paper, CircularProgress, Container, Alert } from '@/components/ui/mui'; // Alert追加
import { useRouter, useSearchParams } from 'next/navigation'; // useSearchParams追加
import { supabase } from '@/lib/supabase';
import { AuthForm } from '@/components/auth/AuthForm';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);

  // URLパラメータのエラーを表示
  const errorParam = searchParams.get('error');
  const detailsParam = searchParams.get('details');
  const reasonParam = searchParams.get('reason');

  useEffect(() => {
    const checkSession = async () => {
      console.log('[LoginPage] Checking session...');

      // サーバー側セッション検証でアイドルタイムアウト/期限切れと判定された場合は
      // Supabase セッションも破棄してログイン画面を表示する（リダイレクトループ防止）
      if (reasonParam === 'idle_timeout') {
        await supabase.auth.signOut();
        setChecking(false);
        return;
      }

      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
          console.error('[LoginPage] GetSession Error:', error);
      }

      if (session) {
        // next パラメータがあればそちらへ、なければ /app へ
        const nextParam = searchParams.get('next');
        const dest = nextParam?.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/app';
        console.log('[LoginPage] Session found. Redirecting to', dest, session.user.id);
        router.replace(dest);
      } else {
        console.log('[LoginPage] No session found.');
        setChecking(false);
      }
    };
    checkSession();
  }, [router, reasonParam]);

  if (checking) {
    return (
      <Box height="100vh" display="flex" flexDirection="column" justifyContent="center" alignItems="center" bgcolor="background.default">
        <CircularProgress />
        <p style={{ marginTop: 10, color: 'text.secondary' }}>Checking Session...</p>
      </Box>
    );
  }

  return (
    <Box 
      sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        bgcolor: 'background.default',
        py: 4
      }}
    >
      <Container maxWidth="xs">
        {/* エラーがあれば表示 */}
        {(errorParam || detailsParam) && (
             <Alert severity="error" sx={{ mb: 2 }}>
                 Login Error: {errorParam} <br/>
                 {detailsParam}
             </Alert>
        )}
        
        <Paper 
          elevation={0} 
          sx={{ 
            p: { xs: 4, sm: 5 }, 
            borderRadius: 4, 
            border: '1px solid', borderColor: 'divider',
            boxShadow: 1,
            width: '100%',
            bgcolor: 'background.paper'
          }}
        >
          <AuthForm />
        </Paper>
      </Container>
    </Box>
  );
}
