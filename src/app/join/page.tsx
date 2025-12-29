// app/join/page.tsx
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
    Box, Button, Container, TextField, Typography, Paper, Stack, Alert, CircularProgress
} from '@mui/material';
import { supabase } from '@/lib/supabase';

function JoinContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const code = searchParams.get('code');

    const [loading, setLoading] = useState(true);
    const [validInvite, setValidInvite] = useState<any>(null);

    // フォーム
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');

    const [isRegistering, setIsRegistering] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    // 1. コードチェック & 事前データ読み込み
    useEffect(() => {
        const checkCode = async () => {
            if (!code) {
                setLoading(false);
                return;
            }

            const { data, error } = await supabase
                .from('invitations')
                .select('*, organizations(name)')
                .eq('code', code)
                .eq('is_used', false)
                .single();

            if (error || !data) {
                setValidInvite(null);
            } else {
                setValidInvite(data);
                // ★事前指定された名前があればセットする
                if (data.target_name) {
                    setName(data.target_name);
                }
            }
            setLoading(false);
        };

        checkCode();
    }, [code]);

    // 2. 登録処理
    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validInvite) return;
        setIsRegistering(true);
        setErrorMsg('');

        try {
            // Auth作成
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error('ユーザー作成失敗');

            // Profile作成
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: authData.user.id,
                    organization_id: validInvite.organization_id,
                    name: name, // ここで入力(または事前指定)された名前を使う
                    role: 'staff'
                });

            if (profileError) throw profileError;

            // ★事前指定された担当がいれば登録
            if (validInvite.target_client_ids && validInvite.target_client_ids.length > 0) {
                const assignments = validInvite.target_client_ids.map((clientId: string) => ({
                    helper_id: authData.user!.id,
                    client_id: clientId
                }));

                await supabase.from('assignments').insert(assignments);
            }

            // 招待コードを使用済みに
            await supabase
                .from('invitations')
                .update({ is_used: true })
                .eq('id', validInvite.id);

            alert('登録が完了しました！');
            router.push('/helper');

        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.message || '登録エラー');
        } finally {
            setIsRegistering(false);
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
    if (!code || !validInvite) return <Container sx={{ mt: 10 }}><Alert severity="error">無効なリンクです</Alert></Container>;

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5' }}>
            <Container maxWidth="xs">
                <Paper elevation={0} sx={{ p: 4, borderRadius: 3, border: '1px solid #ddd' }}>
                    <Box textAlign="center" mb={3}>
                        <Typography variant="h6" fontWeight="bold" color="primary">スタッフ招待</Typography>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            事業所: <strong>{validInvite.organizations?.name}</strong>
                        </Typography>
                    </Box>

                    {errorMsg && <Alert severity="error" sx={{ mb: 2 }}>{errorMsg}</Alert>}

                    <form onSubmit={handleRegister}>
                        <Stack spacing={2}>
                            <TextField
                                label="お名前"
                                required
                                fullWidth
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            // 事前指定がある場合は読み取り専用にするかどうか？
                            // 今回は「修正可能」にしておきますが、固定したい場合は disabled={!!validInvite.target_name} を追加
                            />
                            <TextField
                                label="メールアドレス"
                                type="email"
                                required
                                fullWidth
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <TextField
                                label="パスワード設定"
                                type="password"
                                required
                                fullWidth
                                helperText="6文字以上"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <Button type="submit" variant="contained" size="large" fullWidth disabled={isRegistering} sx={{ fontWeight: 'bold' }}>
                                {isRegistering ? '処理中...' : '登録して参加する'}
                            </Button>
                        </Stack>
                    </form>
                </Paper>
            </Container>
        </Box>
    );
}

export default function JoinPage() {
    return (
        <Suspense fallback={<CircularProgress />}>
            <JoinContent />
        </Suspense>
    );
}