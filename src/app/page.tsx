// app/page.tsx
'use client';

import { useState } from 'react';
import {
  Box, Button, Container, TextField, Typography, Paper, Stack, Alert, CircularProgress, Divider
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// アイコン (GoogleなどはMUI標準にないのでテキストか画像で代用推奨ですが、ここではGoogleIcon等がある前提またはテキストで実装)
import GoogleIcon from '@mui/icons-material/Google';
import AppleIcon from '@mui/icons-material/Apple';
import MicrosoftIcon from '@mui/icons-material/Window'; // Microsoftの代用

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [userName, setUserName] = useState('');

  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

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

  // SSOログイン処理
  const handleOAuth = async (provider: 'google' | 'azure' | 'apple') => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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

  // ログイン後の振り分け
  const checkProfileAndRedirect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // プロフィールがあるか確認
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();

    if (profile) {
      if (profile.role === 'staff') router.push('/helper');
      else router.push('/admin/dashboard');
    } else {
      // プロフィールがない = SSO初回の新規ユーザー -> セットアップへ
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

            {/* SSOボタンエリア (ログインモード時のみ表示推奨だが、登録時も同じフローでいける) */}
            {isLoginMode && (
              <Stack spacing={1.5}>
                <Button variant="outlined" startIcon={<GoogleIcon />} onClick={() => handleOAuth('google')} fullWidth sx={{ color: '#333', borderColor: '#ccc' }}>
                  Googleで続ける
                </Button>
                <Button variant="outlined" startIcon={<MicrosoftIcon />} onClick={() => handleOAuth('azure')} fullWidth sx={{ color: '#333', borderColor: '#ccc' }}>
                  Microsoftで続ける
                </Button>
                <Button variant="outlined" startIcon={<AppleIcon />} onClick={() => handleOAuth('apple')} fullWidth sx={{ color: '#333', borderColor: '#ccc' }}>
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