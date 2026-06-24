'use client';

import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Stack, CircularProgress, Card, CardActionArea, Alert
} from '@/components/ui/mui';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { acceptInvitation } from '@/app/actions/accounts';
import { User } from '@supabase/supabase-js';
import BusinessIcon from '@mui/icons-material/Business';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import PersonIcon from '@mui/icons-material/Person';
import { useToast } from '@/components/ui/ToastProvider';
import { createOrganization, updateOwnProfile } from '@/app/actions/user';

type Step = 'profile' | 'choice' | 'create' | 'join';

export default function SetupPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const paramInviteCode = searchParams.get('inviteCode');

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState<Step>('profile');
    const [hasMembership, setHasMembership] = useState(false);
    
    // 入力値
    const [userName, setUserName] = useState('');
    const [orgName, setOrgName] = useState('');
    const [inviteCode, setInviteCode] = useState('');

    useEffect(() => {
        if (paramInviteCode) {
            setInviteCode(paramInviteCode);
        }
    }, [paramInviteCode]);

    useEffect(() => {
        let mounted = true;

        const processUser = async (user: User) => {
            if (!mounted) return;
            console.log('[SetupPage] Session confirmed for:', user.id);

            try {
                const { data: profile, error: profileError } = await supabase.from('profiles').select('name').eq('id', user.id).single();
                
                if (profileError && profileError.code !== 'PGRST116') {
                    console.error('[SetupPage] Profile fetch error:', profileError);
                }

                const { data: members } = await supabase.from('organization_members').select('id').eq('user_id', user.id);
                const isMember = members && members.length > 0;
                setHasMembership(isMember || false);

                if (profile?.name) {
                    setUserName(profile.name);
                    if (paramInviteCode) {
                        setStep('join');
                    } else {
                        setStep('choice');
                    }
                } else {
                    setStep('profile');
                }
                
                if (mounted) setLoading(false);
            } catch (err) {
                console.error('[SetupPage] Setup error:', err);
                if (mounted) setLoading(false);
            }
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log(`[SetupPage] Auth Event: ${event}`);
            
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                if (session) {
                    await processUser(session.user);
                } else if (event === 'INITIAL_SESSION') {
                    // ★重要: 初期チェック完了時にセッションがなければ、認証失敗とみなしてログイン画面へ
                    console.warn('[SetupPage] INITIAL_SESSION received but no session found. Redirecting to login.');
                    if (mounted) router.replace('/?error=session_missing');
                }
            } else if (event === 'SIGNED_OUT') {
                if (mounted) router.replace('/');
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [router, paramInviteCode]);

    // ... (以降の関数群、return部分は変更なし。そのまま維持してください) ...
    // handleSaveProfile, handleCreateOrg, handleJoinOrg, およびJSX部分
    
    const getErrorMessage = (error: unknown): string => {
        if (error instanceof Error) return error.message;
        if (typeof error === 'object' && error !== null && 'message' in error) {
            return String((error as { message: unknown }).message);
        }
        return JSON.stringify(error);
    };

    const handleSaveProfile = async () => {
        if (!userName.trim()) return;
        setSubmitting(true);
        try {
            await updateOwnProfile(userName, true);
            
            if (inviteCode) {
                setStep('join');
            } else {
                setStep('choice');
            }
        } catch (e) {
            console.error('Profile Save Error:', e);
            showToast(`プロフィールの保存に失敗しました: ${getErrorMessage(e)}`, 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCreateOrg = async () => {
        if (!orgName.trim()) return;
        setSubmitting(true);
        try {
            await createOrganization(orgName);
            window.location.href = '/app';
        } catch (e) {
            console.error('Create Org Error:', e);
            showToast(`事業所の作成に失敗しました: ${getErrorMessage(e)}`, 'error');
            setSubmitting(false);
        }
    };

    const handleJoinOrg = async () => {
        if (!inviteCode.trim()) return;
        setSubmitting(true);
        try {
            // 招待の検証・メンバー登録・割り当てはサーバ(service role)で安全に処理する
            const res = await acceptInvitation(inviteCode.trim());
            if (res.alreadyMember) {
                showToast('すでにこの事業所に参加しています。移動します。', 'info');
            }
            window.location.href = '/app';
        } catch (e) {
            console.error('Join Org Error:', e);
            showToast(`参加に失敗しました: ${getErrorMessage(e)}`, 'error');
            setSubmitting(false);
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /><Typography mt={2}>セットアップ情報を取得中...</Typography></Box>;

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
            <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 480, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
                
                {step === 'join' && paramInviteCode && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        招待コードが検出されました。<br/>新しい事業所に参加しますか？
                    </Alert>
                )}

                {step === 'profile' && (
                    <Stack spacing={3}>
                        <Box textAlign="center">
                            <PersonIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                            <Typography variant="h5" fontWeight="bold">ようこそ！</Typography>
                            <Typography variant="body2" color="text.secondary">
                                はじめに、あなたのお名前を教えてください。<br/>
                                (記録や報告書に表示されます)
                            </Typography>
                        </Box>
                        <TextField 
                            label="氏名" 
                            placeholder="例: 山田 太郎" 
                            fullWidth 
                            value={userName} 
                            onChange={(e) => setUserName(e.target.value)} 
                        />
                        <Button 
                            variant="contained" size="large" fullWidth 
                            onClick={handleSaveProfile} disabled={submitting || !userName.trim()}
                        >
                            次へ進む
                        </Button>
                    </Stack>
                )}

                {step === 'choice' && (
                    <Stack spacing={3}>
                        <Box textAlign="center">
                            <Typography variant="h5" fontWeight="bold">事業所の設定</Typography>
                            <Typography variant="body2" color="text.secondary">
                                新しく事業所を立ち上げるか、<br/>既存の事業所に参加するか選んでください。
                            </Typography>
                        </Box>
                        
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                            <CardActionArea onClick={() => setStep('create')} sx={{ p: 2 }}>
                                <Stack direction="row" alignItems="center" spacing={2}>
                                    <Box sx={{ p: 1, bgcolor: 'background.tint', borderRadius: '50%', color: 'primary.main' }}>
                                        <BusinessIcon />
                                    </Box>
                                    <Box>
                                        <Typography fontWeight="bold">新しい事業所を作成する</Typography>
                                        <Typography variant="caption" color="text.secondary">管理者として新しく登録します</Typography>
                                    </Box>
                                </Stack>
                            </CardActionArea>
                        </Card>

                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                            <CardActionArea onClick={() => setStep('join')} sx={{ p: 2 }}>
                                <Stack direction="row" alignItems="center" spacing={2}>
                                    <Box sx={{ p: 1, bgcolor: 'background.muted', borderRadius: '50%', color: 'secondary.main' }}>
                                        <GroupAddIcon />
                                    </Box>
                                    <Box>
                                        <Typography fontWeight="bold">既存の事業所に参加する</Typography>
                                        <Typography variant="caption" color="text.secondary">招待コードをお持ちの方はこちら</Typography>
                                    </Box>
                                </Stack>
                            </CardActionArea>
                        </Card>

                        {hasMembership && (
                            <Button color="inherit" onClick={() => router.push('/app')}>
                                キャンセルしてアプリに戻る
                            </Button>
                        )}
                    </Stack>
                )}

                {step === 'create' && (
                    <Stack spacing={3}>
                        <Box textAlign="center">
                            <BusinessIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                            <Typography variant="h5" fontWeight="bold">事業所の作成</Typography>
                            <Typography variant="body2" color="text.secondary">
                                事業所の名称を入力してください。
                            </Typography>
                        </Box>
                        <TextField 
                            label="事業所名" 
                            placeholder="例: ケアサービス東京" 
                            fullWidth 
                            value={orgName} 
                            onChange={(e) => setOrgName(e.target.value)} 
                        />
                        <Stack direction="row" spacing={2}>
                            <Button fullWidth onClick={() => setStep('choice')} disabled={submitting}>戻る</Button>
                            <Button 
                                variant="contained" fullWidth size="large" 
                                onClick={handleCreateOrg} disabled={submitting || !orgName.trim()}
                            >
                                {submitting ? '作成中...' : '作成して開始'}
                            </Button>
                        </Stack>
                    </Stack>
                )}

                {step === 'join' && (
                    <Stack spacing={3}>
                        <Box textAlign="center">
                            <GroupAddIcon color="secondary" sx={{ fontSize: 40, mb: 1 }} />
                            <Typography variant="h5" fontWeight="bold">事業所に参加</Typography>
                            <Typography variant="body2" color="text.secondary">
                                管理者から共有された招待コードを入力してください。
                            </Typography>
                        </Box>
                        <TextField 
                            label="招待コード" 
                            placeholder="コードを入力" 
                            fullWidth 
                            value={inviteCode} 
                            onChange={(e) => setInviteCode(e.target.value)} 
                        />
                        <Stack direction="row" spacing={2}>
                            <Button fullWidth onClick={() => paramInviteCode ? router.push('/app') : setStep('choice')} disabled={submitting}>
                                {paramInviteCode ? 'キャンセル' : '戻る'}
                            </Button>
                            <Button 
                                variant="contained" fullWidth size="large" 
                                onClick={handleJoinOrg} disabled={submitting || !inviteCode.trim()}
                            >
                                {submitting ? '参加中...' : '参加する'}
                            </Button>
                        </Stack>
                    </Stack>
                )}

            </Paper>
        </Box>
    );
}
