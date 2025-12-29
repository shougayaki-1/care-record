// app/setup/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Stack, CircularProgress, Alert
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BusinessIcon from '@mui/icons-material/Business';

export default function SetupPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [orgName, setOrgName] = useState('');
    const [userName, setUserName] = useState('');
    const [userId, setUserId] = useState('');

    useEffect(() => {
        checkUser();
    }, []);

    const checkUser = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            router.push('/');
            return;
        }
        setUserId(user.id);

        // 既にプロフィールがある場合はセットアップ不要
        const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).single();
        if (profile) {
            router.push('/admin/dashboard');
        } else {
            setLoading(false);
        }
    };

    const handleSetup = async () => {
        if (!orgName || !userName) return;
        setSaving(true);

        try {
            // 1. 事業所作成
            const { data: org, error: orgError } = await supabase
                .from('organizations')
                .insert([{ name: orgName }])
                .select()
                .single();

            if (orgError) throw orgError;

            // 2. プロフィール作成 (Ownerとして)
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: userId,
                    organization_id: org.id,
                    name: userName,
                    role: 'owner',
                    is_agreed: true, // ここで作成する＝規約同意済みとみなす
                    agreed_at: new Date().toISOString()
                });

            if (profileError) throw profileError;

            window.location.href = '/admin/dashboard'; // リロード込みで移動
        } catch (error) {
            console.error(error);
            alert('セットアップに失敗しました');
            setSaving(false);
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5' }}>
            <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 450, borderRadius: 3, border: '1px solid #ddd' }}>
                <Box textAlign="center" mb={3}>
                    <BusinessIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                    <Typography variant="h5" fontWeight="bold">初期セットアップ</Typography>
                    <Typography variant="body2" color="text.secondary">
                        事業所名とあなたのお名前を登録してください。
                    </Typography>
                </Box>

                <Stack spacing={3}>
                    <TextField
                        label="事業所名"
                        fullWidth
                        required
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder="例: ケアサービス東京"
                    />
                    <TextField
                        label="管理者氏名"
                        fullWidth
                        required
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="例: 山田 太郎"
                    />
                    <Button
                        variant="contained"
                        size="large"
                        fullWidth
                        onClick={handleSetup}
                        disabled={saving || !orgName || !userName}
                        sx={{ fontWeight: 'bold', py: 1.5 }}
                    >
                        {saving ? '設定中...' : '利用を開始する'}
                    </Button>
                </Stack>
            </Paper>
        </Box>
    );
}