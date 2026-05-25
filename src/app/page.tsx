'use client';

import { useEffect, useState } from 'react';
import { Box, Paper, CircularProgress, Container, Alert } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthForm } from '@/components/auth/AuthForm';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);

  const errorParam = searchParams.get('error');
  const detailsParam = searchParams.get('details');
  const nextUrl = searchParams.get('next') || '/app';

  useEffect(() => {
    let mounted = true;

    // getSession の一発判定ではなく、onAuthStateChange でセッション確定を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (
        (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
        session
      ) {
        router.replace(nextUrl);
        return;
      }

      // INITIAL_SESSION が発火し、かつセッションが未確立であることが確定した場合のみフォームを表示
      if (event === 'INITIAL_SESSION' && !session) {
        setChecking(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router, nextUrl]);

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