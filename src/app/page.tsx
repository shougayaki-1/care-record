'use client';

import { useEffect, useState } from 'react';
import { Box, Paper, CircularProgress, Container, Alert } from '@mui/material'; // Alert追加
import { useRouter, useSearchParams } from 'next/navigation'; // useSearchParams追加
import { supabase } from '@/lib/supabase';
import { AuthForm } from '@/components/auth/AuthForm';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const [debugMsg, setDebugMsg] = useState(''); // デバッグ表示用

  // URLパラメータのエラーを表示
  const errorParam = searchParams.get('error');
  const detailsParam = searchParams.get('details');

  useEffect(() => {
    const checkSession = async () => {
      console.log('[LoginPage] Checking session...');
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
          console.error('[LoginPage] GetSession Error:', error);
      }

      if (session) {
        console.log('[LoginPage] Session found. Redirecting to /app', session.user.id);
        router.replace('/app');
      } else {
        console.log('[LoginPage] No session found.');
        setChecking(false);
        // デバッグ用にコンソールだけでなく画面にも出す（必要なら）
        setDebugMsg('No Session Found');
      }
    };
    checkSession();
  }, [router]);

  if (checking) {
    return (
      <Box height="100vh" display="flex" flexDirection="column" justifyContent="center" alignItems="center" bgcolor="#f8f9fa">
        <CircularProgress />
        <p style={{ marginTop: 10, color: '#666' }}>Checking Session...</p>
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
        bgcolor: '#f0f2f5',
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
            border: '1px solid #e0e0e0', 
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
            width: '100%',
            bgcolor: '#ffffff'
          }}
        >
          <AuthForm />
        </Paper>
      </Container>
    </Box>
  );
}