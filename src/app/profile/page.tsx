// app/profile/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Alert, Stack, Divider,
    Container, AppBar, Toolbar, IconButton, CircularProgress
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ProfilePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // ユーザー情報
    const [userId, setUserId] = useState('');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState('');

    // パスワード変更用
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }
            setUserId(user.id);
            setEmail(user.email || '');

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

    const handleUpdateProfile = async () => {
        setMessage(null);
        if (!name.trim()) {
            setMessage({ type: 'error', text: '名前を入力してください' });
            return;
        }

        // パスワード変更がある場合のチェック
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
            // 1. 名前更新
            const { error: profileError } = await supabase
                .from('profiles')
                .update({ name: name })
                .eq('id', userId);

            if (profileError) throw profileError;

            // 2. パスワード更新（入力がある場合のみ）
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

    // 戻るボタンの遷移先判定
    const handleBack = () => {
        if (role === 'staff') {
            router.push('/helper');
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
                    <Stack spacing={4}>

                        {/* 基本情報 */}
                        <Box>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <PersonIcon color="primary" /> 基本情報
                            </Typography>
                            <Stack spacing={2} mt={1}>
                                <TextField
                                    label="メールアドレス"
                                    value={email}
                                    disabled
                                    helperText="メールアドレスは変更できません"
                                    fullWidth
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

                        {/* パスワード変更 */}
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