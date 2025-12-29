// app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Box, Button, Container, TextField, Typography, Paper, Stack, Alert, CircularProgress, Divider
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// アイコン (MUIにないものは文字で代用か、別途SVGコンポーネント化推奨)
import GoogleIcon from '@mui/icons-material/Google';
import AppleIcon from '@mui/icons-material/Apple';
import MicrosoftIcon from '@mui/icons-material/Window';

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [userName, setUserName] = useState('');

  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // マウント時にURLを取得してリダイレクト先を決定
  const [redirectUrl, setRedirectUrl] = useState('');
  useEffect(() => {
    setRedirectUrl(`${window.location.origin}/auth/callback`);
  }, []);

  // SSOログイン処理
  const handleOAuth = async (provider: 'google' | 'azure' | 'apple') => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: redirectUrl, // ★ここが重要：現在のドメインのCallback URLを指定
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) {
      setMessage({ type: 'error', text: error.message });
      setLoading(false);
    }
  };

  // メールログイン・登録処理
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        checkProfileAndRedirect();
      } else {
        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        if (!authData.user) throw new Error('ユーザー作成失敗');

        const { data: orgData, error: orgError } = await supabase.from('organizations').insert([{ name: orgName }]).select().single();
        if (orgError) throw orgError;

        const { error: profileError } = await supabase.from('profiles').insert([{
          id: authData.user.id,
          organization_id: orgData.id,
          name: userName,
          role: 'owner',
          is_agreed: true,
          agreed_at: new Date().toISOString()
        }]);
        if (profileError) throw profileError;

        setMessage({ type: 'success', text: '登録完了！ログインしました。' });
        setTimeout(() => router.push('/admin/dashboard'), 1000);
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'エラーが発生しました' });
      setLoading(false);
    }
  };

  // ログイン後の振り分け
  const checkProfileAndRedirect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();

    if (profile) {
      if (profile.role === 'staff') router.push('/helper');
      else router.push('/admin/dashboard');
    } else {
      router.push('/setup');
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5' }}>
      <Container maxWidth="xs">
        <Paper elevation={0} sx={{ p: 4, borderRadius: 3, border: '1px solid #e0e0e0' }}>
          <Stack spacing={3}>
            <Box textAlign="center">
              <Typography variant="h5" component="h1" fontWeight="800" color="primary">CareRecord SaaS</Typography>
              <Typography variant="body2" color="text.secondary">{isLoginMode ? 'ログイン' : '新規事業所登録'}</Typography>
            </Box>

            {message && <Alert severity={message.type}>{message.text}</Alert>}

            {isLoginMode && (
              <Stack spacing={1.5}>
                <Button variant="outlined" startIcon={<GoogleIcon />} onClick={() => handleOAuth('google')} fullWidth sx={{ color: '#333', borderColor: '#ccc', py: 1.5 }}>
                  Googleで続ける
                </Button>
                <Button variant="outlined" startIcon={<MicrosoftIcon />} onClick={() => handleOAuth('azure')} fullWidth sx={{ color: '#333', borderColor: '#ccc', py: 1.5 }}>
                  Microsoftで続ける
                </Button>
                <Button variant="outlined" startIcon={<AppleIcon />} onClick={() => handleOAuth('apple')} fullWidth sx={{ color: '#333', borderColor: '#ccc', py: 1.5 }}>
                  Appleで続ける
                </Button>

                <Divider sx={{ my: 1, fontSize: 12, color: '#666' }}>またはメールアドレスで</Divider>
              </Stack>
            )}

            <form onSubmit={handleAuth}>
              <Stack spacing={2}>
                {!isLoginMode && (
                  <>
                    <TextField label="事業所名" fullWidth required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                    <TextField label="管理者氏名" fullWidth required value={userName} onChange={(e) => setUserName(e.target.value)} />
                  </>
                )}
                <TextField label="メールアドレス" type="email" fullWidth required value={email} onChange={(e) => setEmail(e.target.value)} />
                <TextField label="パスワード" type="password" fullWidth required helperText={!isLoginMode ? "6文字以上" : ""} value={password} onChange={(e) => setPassword(e.target.value)} />

                <Button type="submit" variant="contained" size="large" fullWidth disabled={loading} sx={{ mt: 2, height: 48, fontWeight: 'bold' }}>
                  {loading ? <CircularProgress size={24} color="inherit" /> : (isLoginMode ? 'ログイン' : '登録して開始')}
                </Button>
              </Stack>
            </form>

            <Button size="small" onClick={() => { setIsLoginMode(!isLoginMode); setMessage(null); }}>
              {isLoginMode ? '新しく事業所を登録する' : 'すでにアカウントをお持ちの方'}
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}