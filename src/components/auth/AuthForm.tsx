'use client';

import { useState, useEffect } from 'react';
import {
    Box, Button, TextField, Typography, Stack, Alert, CircularProgress, Divider, Tabs, Tab, Fade
} from '@/components/ui/mui';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';

// ... (Logoコンポーネントは省略、そのまま使用) ...
const GoogleLogo = () => (
    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
);
const MicrosoftLogo = () => (
    <svg width="20" height="20" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
);

export const AuthForm = () => {
    const searchParams = useSearchParams();
    
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    // 0: ログイン, 1: 新規登録
    const [tabIndex, setTabIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
    const [origin, setOrigin] = useState('');

    const isRegisterMode = tabIndex === 1;
    const nextUrl = searchParams.get('next') || '/app';
    const errorParam = searchParams.get('error'); // エラーパラメータの取得

    useEffect(() => {
        setOrigin(window.location.origin);
        if (errorParam === 'auth_callback_failed') {
            setMessage({ type: 'error', text: 'ログイン処理に失敗しました。もう一度お試しください。' });
        }
    }, [errorParam]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
        setMessage(null);
        setPassword('');
    };

    const handleOAuth = async (provider: 'google' | 'azure') => {
        if (!origin) return;
        setLoading(true);
        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
                queryParams: { access_type: 'offline', prompt: 'consent' },
            },
        });
        if (error) {
            setMessage({ type: 'error', text: error.message });
            setLoading(false);
        }
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            if (isRegisterMode) {
                // --- 新規アカウント作成 ---
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                });

                if (error) throw error;
                
                if (data.user && data.user.identities && data.user.identities.length === 0) {
                    setMessage({ 
                        type: 'info', 
                        text: 'このメールアドレスは既に登録されています。ログインしてください。' 
                    });
                    setTabIndex(0);
                } else if (data.user) {
                    setMessage({ type: 'success', text: 'アカウントを作成しました。自動的にログインします...' });
                    setTimeout(() => { window.location.href = nextUrl; }, 1000);
                }
            } else {
                // --- ログイン ---
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    if (error.message.includes('Invalid login credentials')) {
                        throw new Error('メールアドレスまたはパスワードが正しくありません。');
                    }
                    if (error.message.includes('Email not confirmed')) {
                        throw new Error('メールアドレスの確認が完了していません。');
                    }
                    throw error;
                }
                // Routerではなくwindow.locationで確実にリロードさせる
                window.location.href = nextUrl;
            }
        } catch (err) {
            console.error(err);
            let errorMessage = 'エラーが発生しました';
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            if (errorMessage.includes('User already registered')) {
                errorMessage = 'このメールアドレスは既に登録されています。ログインしてください。';
                setTabIndex(0);
                setMessage({ type: 'info', text: errorMessage });
                setLoading(false);
                return;
            }
            setMessage({ type: 'error', text: errorMessage });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Stack spacing={3}>
            {/* ... (表示部分は変更なし) ... */}
            <Box textAlign="center" mb={1}>
                <Typography
                    variant="h4"
                    component="h1"
                    sx={{ fontFamily: 'var(--font-poppins)', fontWeight: 700, color: 'primary.main', letterSpacing: '-0.5px' }}
                >
                    CareRecord
                </Typography>
                <Typography variant="body2" color="text.secondary" mt={1}>
                    訪問介護記録プラットフォーム
                </Typography>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={tabIndex} onChange={handleTabChange} variant="fullWidth">
                    <Tab label="ログイン" />
                    <Tab label="新規登録" />
                </Tabs>
            </Box>

            <Fade in={true} key={tabIndex}>
                <Box>
                    <Box textAlign="center" mb={3}>
                        <Typography variant="h6" fontWeight="bold">
                            {isRegisterMode ? 'アカウントを作成' : 'おかえりなさい'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {isRegisterMode 
                                ? 'メールアドレスで登録を開始します' 
                                : 'アカウントにサインインしてください'}
                        </Typography>
                    </Box>

                    {message && (
                        <Alert severity={message.type} sx={{ borderRadius: 2, mb: 3 }}>
                            {message.text}
                        </Alert>
                    )}

                    <Stack spacing={1.5} mb={3}>
                        <Button variant="outlined" startIcon={<GoogleLogo />} onClick={() => handleOAuth('google')} fullWidth sx={{ color: '#3c4043', borderColor: '#dadce0', bgcolor: 'background.paper', textTransform: 'none', py: 1.2 }}>
                            Google で{isRegisterMode ? '登録' : 'ログイン'}
                        </Button>
                        <Button variant="contained" startIcon={<MicrosoftLogo />} onClick={() => handleOAuth('azure')} fullWidth sx={{ color: '#fff', bgcolor: '#2F2F2F', textTransform: 'none', py: 1.2, '&:hover': { bgcolor: '#1a1a1a' } }}>
                            Microsoft で{isRegisterMode ? '登録' : 'ログイン'}
                        </Button>
                    </Stack>

                    <Divider sx={{ mb: 3, fontSize: 12, color: 'text.secondary' }}>またはメールアドレス</Divider>

                    <form onSubmit={handleAuth}>
                        <Stack spacing={2.5}>
                            <TextField 
                                label="メールアドレス" 
                                type="email" 
                                fullWidth 
                                required 
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                size="small"
                                autoComplete="email"
                            />
                            <TextField 
                                label="パスワード" 
                                type="password" 
                                fullWidth 
                                required 
                                helperText={isRegisterMode ? "6文字以上で設定してください" : ""} 
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)} 
                                size="small"
                                autoComplete={isRegisterMode ? "new-password" : "current-password"}
                            />

                            <Button 
                                type="submit" 
                                variant="contained" 
                                size="large" 
                                fullWidth 
                                disabled={loading} 
                                sx={{ 
                                    py: 1.5, 
                                    fontWeight: 'bold', 
                                    fontSize: '1rem', 
                                    boxShadow: 'none',
                                    bgcolor: isRegisterMode ? '#2255CC' : undefined
                                }}
                            >
                                {loading ? <CircularProgress size={24} color="inherit" /> : (isRegisterMode ? 'アカウントを作成' : 'ログイン')}
                            </Button>
                        </Stack>
                    </form>
                </Box>
            </Fade>

            {!isRegisterMode && (
                <Box textAlign="center" mt={2}>
                    <Typography variant="caption" color="text.secondary">
                        スタッフとして参加される方は、<br/>
                        管理者から送付された招待リンクより登録することを推奨します。
                    </Typography>
                </Box>
            )}
        </Stack>
    );
};