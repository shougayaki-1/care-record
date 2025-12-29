'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Alert, Stack, Divider,
    Container, AppBar, Toolbar, IconButton, CircularProgress, Chip
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import LinkIcon from '@mui/icons-material/Link';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ブランドロゴ (AuthFormと同じもの)
const GoogleLogo = () => (
    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
);
const MicrosoftLogo = () => (
    <svg width="20" height="20" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
);

export default function ProfilePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // ユーザー情報
    const [userId, setUserId] = useState('');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState('');

    // 連携状態
    const [linkedProviders, setLinkedProviders] = useState<string[]>([]);

    // パスワード変更用
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            // 1. Auth情報の取得
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }
            setUserId(user.id);
            setEmail(user.email || '');

            // 連携済みプロバイダーの確認
            if (user.identities) {
                const providers = user.identities.map((id: any) => id.provider);
                setLinkedProviders(providers);
            }

            // 2. プロフィール情報の取得
            const { data: profile } = await supabase
                .from('profiles')
                .select('name, role')
                .eq('id', user.id)
                .single();

            if (profile) {
                setName(profile.name);
                setRole(profile.role);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // プロフィール更新処理
    const handleUpdateProfile = async () => {
        setMessage(null);
        if (!name.trim()) {
            setMessage({ type: 'error', text: '名前を入力してください' });
            return;
        }

        if (newPassword || confirmPassword) {
            if (newPassword.length < 6) {
                setMessage({ type: 'error', text: 'パスワードは6文字以上で設定してください' });
                return;
            }
            if (newPassword !== confirmPassword) {
                setMessage({ type: 'error', text: 'パスワードが一致しません' });
                return;
            }
        }

        setSaving(true);
        try {
            const { error: profileError } = await supabase
                .from('profiles')
                .update({ name: name })
                .eq('id', userId);

            if (profileError) throw profileError;

            if (newPassword) {
                const { error: authError } = await supabase.auth.updateUser({
                    password: newPassword
                });
                if (authError) throw authError;
            }

            setMessage({ type: 'success', text: 'プロフィールを更新しました' });
            setNewPassword('');
            setConfirmPassword('');

        } catch (error: any) {
            console.error(error);
            setMessage({ type: 'error', text: '更新に失敗しました: ' + error.message });
        } finally {
            setSaving(false);
        }
    };

    // アカウント連携処理
    const handleLinkIdentity = async (provider: 'google' | 'azure') => {
        setLoading(true);
        try {
            const { data, error } = await supabase.auth.linkIdentity({
                provider: provider,
                options: {
                    // 連携完了後にこのページに戻ってくる
                    redirectTo: `${window.location.origin}/profile`,
                }
            });
            if (error) throw error;
            // 成功するとリダイレクトされるため、ここには到達しない想定
        } catch (error: any) {
            console.error(error);
            setMessage({ type: 'error', text: '連携に失敗しました: ' + error.message });
            setLoading(false);
        }
    };

    // 戻るボタンの遷移先判定
    const handleBack = () => {
        if (role === 'staff') {
            router.push('/helper');
        } else if (role === 'super_admin') {
            router.push('/super-admin');
        } else {
            router.push('/admin/dashboard');
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f5', pb: 4 }}>
            <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: '#fff' }}>
                <Toolbar>
                    <IconButton edge="start" onClick={handleBack}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography variant="h6" sx={{ flexGrow: 1, ml: 1, fontWeight: 'bold' }}>
                        アカウント設定
                    </Typography>
                </Toolbar>
            </AppBar>

            <Container maxWidth="sm" sx={{ mt: 4 }}>
                {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                <Paper sx={{ p: 4, borderRadius: 3 }}>
                    <Stack spacing={5}>

                        {/* 1. 基本情報 */}
                        <Box>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <PersonIcon color="primary" /> 基本情報
                            </Typography>
                            <Stack spacing={2} mt={1}>
                                <TextField
                                    label="メールアドレス"
                                    value={email}
                                    disabled
                                    fullWidth
                                    size="small"
                                />
                                <TextField
                                    label="氏名"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    fullWidth
                                    required
                                />
                                <TextField
                                    label="権限"
                                    value={role}
                                    disabled
                                    fullWidth
                                    size="small"
                                />
                            </Stack>
                        </Box>

                        <Divider />

                        {/* 2. 外部アカウント連携 (SSO) */}
                        <Box>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LinkIcon color="primary" /> 外部アカウント連携
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                                GoogleやMicrosoftのアカウントでログインできるようにします。
                            </Typography>

                            <Stack spacing={2}>
                                {/* Google */}
                                <Box display="flex" alignItems="center" justifyContent="space-between" p={2} border="1px solid #eee" borderRadius={2}>
                                    <Box display="flex" alignItems="center" gap={2}>
                                        <GoogleLogo />
                                        <Typography fontWeight="bold" color="#555">Google</Typography>
                                    </Box>
                                    {linkedProviders.includes('google') ? (
                                        <Chip label="連携済み" color="success" size="small" icon={<CheckCircleIcon />} variant="outlined" />
                                    ) : (
                                        <Button variant="outlined" size="small" onClick={() => handleLinkIdentity('google')}>
                                            連携する
                                        </Button>
                                    )}
                                </Box>

                                {/* Microsoft */}
                                <Box display="flex" alignItems="center" justifyContent="space-between" p={2} border="1px solid #eee" borderRadius={2}>
                                    <Box display="flex" alignItems="center" gap={2}>
                                        <MicrosoftLogo />
                                        <Typography fontWeight="bold" color="#555">Microsoft</Typography>
                                    </Box>
                                    {linkedProviders.includes('azure') ? (
                                        <Chip label="連携済み" color="success" size="small" icon={<CheckCircleIcon />} variant="outlined" />
                                    ) : (
                                        <Button variant="outlined" size="small" onClick={() => handleLinkIdentity('azure')}>
                                            連携する
                                        </Button>
                                    )}
                                </Box>
                            </Stack>
                        </Box>

                        <Divider />

                        {/* 3. パスワード変更 */}
                        <Box>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LockIcon color="primary" /> パスワード変更
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                                変更する場合のみ入力してください。
                            </Typography>
                            <Stack spacing={2}>
                                <TextField
                                    label="新しいパスワード"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    fullWidth
                                />
                                <TextField
                                    label="新しいパスワード（確認）"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    fullWidth
                                />
                            </Stack>
                        </Box>

                        {/* 保存ボタン */}
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={<SaveIcon />}
                            onClick={handleUpdateProfile}
                            disabled={saving}
                            sx={{ fontWeight: 'bold', py: 1.5 }}
                        >
                            {saving ? '保存中...' : '変更を保存する'}
                        </Button>
                    </Stack>
                </Paper>
            </Container>
        </Box>
    );
}