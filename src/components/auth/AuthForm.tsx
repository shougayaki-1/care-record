// src/components/auth/AuthForm.tsx
'use client';

import { useState, useEffect } from 'react';
import {
    Box, Button, TextField, Typography, Stack, Alert, CircularProgress, Divider
} from '@mui/material';
import { supabase } from '@/lib/supabase';

// SVG Icons
const GoogleLogo = () => (
    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
);
const MicrosoftLogo = () => (
    <svg width="20" height="20" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
);

type Props = {
    mode: 'admin' | 'staff'; // admin: 新規登録あり, staff: ログインのみ
};

export const AuthForm = ({ mode }: Props) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [orgName, setOrgName] = useState('');
    const [userName, setUserName] = useState('');

    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [origin, setOrigin] = useState('');

    useEffect(() => {
        setOrigin(window.location.origin);
    }, []);

    // SSOログイン
    const handleOAuth = async (provider: 'google' | 'azure') => {
        if (!origin) return;
        setLoading(true);
        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: `${origin}/auth/callback`,
                queryParams: { access_type: 'offline', prompt: 'consent' },
            },
        });
        if (error) {
            setMessage({ type: 'error', text: error.message });
            setLoading(false);
        }
    };

    // メール認証
    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            if (isRegisterMode && mode === 'admin') {
                // --- 新規事業所登録 (Adminのみ) ---
                // 1. Authユーザー作成
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (authError) throw authError;
                if (!authData.user) throw new Error('ユーザー作成失敗');

                // 2. RPCを使って事業所とプロフィールを一括作成 (RLS回避のため)
                // ※signUp直後でセッションが確立されている前提
                const { error: rpcError } = await supabase.rpc('register_organization_and_profile', {
                    org_name: orgName,
                    user_name: userName
                });

                if (rpcError) throw rpcError;

                setMessage({ type: 'success', text: '登録完了！ダッシュボードへ移動します。' });

                // 画面遷移
                setTimeout(() => { window.location.href = '/admin/dashboard'; }, 1000);

            } else {
                // --- ログイン (Admin/Staff共通) ---
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;

                // ログイン成功後のリダイレクト
                // Staffならヘルパー画面、Adminならダッシュボードへ
                window.location.href = mode === 'staff' ? '/helper' : '/admin/dashboard';
            }
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'error', text: err.message || 'エラーが発生しました' });
            setLoading(false);
        }
    };

    return (
        <Stack spacing={4}>
            <Box textAlign="center">
                <Typography
                    variant="h4"
                    component="h1"
                    sx={{ fontFamily: 'var(--font-poppins)', fontWeight: 700, color: '#2255CC', letterSpacing: '-0.5px' }}
                >
                    CareRecord
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1} fontWeight="bold">
                    {mode === 'admin' ? '管理者・事業所向け' : 'ヘルパー・スタッフ向け'}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                    {isRegisterMode ? '新規事業所登録' : 'ログイン'}
                </Typography>
            </Box>

            {message && <Alert severity={message.type} sx={{ borderRadius: 2 }}>{message.text}</Alert>}

            <Stack spacing={1.5}>
                <Button variant="outlined" startIcon={<GoogleLogo />} onClick={() => handleOAuth('google')} fullWidth sx={{ color: '#3c4043', borderColor: '#dadce0', bgcolor: '#fff', textTransform: 'none', py: 1.2 }}>
                    Google で続ける
                </Button>
                <Button variant="contained" startIcon={<MicrosoftLogo />} onClick={() => handleOAuth('azure')} fullWidth sx={{ color: '#fff', bgcolor: '#2F2F2F', textTransform: 'none', py: 1.2, '&:hover': { bgcolor: '#1a1a1a' } }}>
                    Microsoft で続ける
                </Button>
            </Stack>

            <Divider sx={{ fontSize: 12, color: '#666' }}>またはメールアドレス</Divider>

            <form onSubmit={handleAuth}>
                <Stack spacing={2.5}>
                    {isRegisterMode && mode === 'admin' && (
                        <>
                            <TextField label="事業所名" fullWidth required value={orgName} onChange={(e) => setOrgName(e.target.value)} size="small" />
                            <TextField label="管理者氏名" fullWidth required value={userName} onChange={(e) => setUserName(e.target.value)} size="small" />
                        </>
                    )}
                    <TextField label="メールアドレス" type="email" fullWidth required value={email} onChange={(e) => setEmail(e.target.value)} size="small" />
                    <TextField label="パスワード" type="password" fullWidth required helperText={!isRegisterMode ? "" : "6文字以上"} value={password} onChange={(e) => setPassword(e.target.value)} size="small" />

                    <Button type="submit" variant="contained" size="large" fullWidth disabled={loading} sx={{ py: 1.5, fontWeight: 'bold', fontSize: '1rem', boxShadow: 'none' }}>
                        {loading ? <CircularProgress size={24} color="inherit" /> : (isRegisterMode ? '登録して開始' : 'ログイン')}
                    </Button>
                </Stack>
            </form>

            {/* モード切替エリア */}
            <Box textAlign="center">
                {mode === 'admin' ? (
                    <Button onClick={() => { setIsRegisterMode(!isRegisterMode); setMessage(null); }} sx={{ textTransform: 'none' }}>
                        {isRegisterMode ? 'すでにアカウントをお持ちの方' : '新しい事業所を登録する'}
                    </Button>
                ) : (
                    <Typography variant="caption" color="text.secondary">
                        ※スタッフとして新規登録する場合は、<br />管理者から送られた招待リンクを使用してください。
                    </Typography>
                )}
            </Box>
        </Stack>
    );
};