'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Stack, CircularProgress, Card, CardActionArea, Alert
} from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BusinessIcon from '@mui/icons-material/Business';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import PersonIcon from '@mui/icons-material/Person';

type Step = 'profile' | 'choice' | 'create' | 'join';

export default function SetupPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const paramInviteCode = searchParams.get('inviteCode');

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState<Step>('profile');
    const [userId, setUserId] = useState('');
    const [hasMembership, setHasMembership] = useState(false); // ★追加: 既存メンバーかどうかのフラグ
    
    // 入力値
    const [userName, setUserName] = useState('');
    const [orgName, setOrgName] = useState('');
    const [inviteCode, setInviteCode] = useState('');

    useEffect(() => {
        if (paramInviteCode) {
            setInviteCode(paramInviteCode);
        }
    }, [paramInviteCode]);

    const checkUser = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            router.push('/');
            return;
        }
        setUserId(user.id);

        // プロフィール確認
        const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).single();
        
        // 名前があればセット
        if (profile?.name) {
            setUserName(profile.name);
        }

        // 所属確認
        const { data: members } = await supabase.from('organization_members').select('id').eq('user_id', user.id);
        const isMember = members && members.length > 0;
        setHasMembership(isMember || false);

        // ★修正: 既存メンバーでも、明示的にこのページに来た場合はアクセスを許可する
        // (以前はここで /app にリダイレクトしていた)

        // 画面遷移の判定
        if (profile?.name) {
            // 名前登録済みなら、招待コードがあれば即参加画面、なければ選択画面
            if (paramInviteCode) {
                setStep('join');
            } else {
                setStep('choice');
            }
        } else {
            // 名前未登録ならプロフィール入力へ
            setStep('profile');
        }
        
        setLoading(false);
    }, [router, paramInviteCode]);

    useEffect(() => {
        checkUser();
    }, [checkUser]);

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
            const { error } = await supabase.from('profiles').upsert({ id: userId, name: userName, is_agreed: true, agreed_at: new Date().toISOString() });
            if (error) throw error;
            
            if (inviteCode) {
                setStep('join');
            } else {
                setStep('choice');
            }
        } catch (e) {
            console.error('Profile Save Error:', e);
            alert(`プロフィールの保存に失敗しました: ${getErrorMessage(e)}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCreateOrg = async () => {
        if (!orgName.trim()) return;
        setSubmitting(true);
        try {
            const { data: orgId, error } = await supabase.rpc('create_organization', { 
                org_name: orgName 
            });
            
            if (error) throw error;

            await supabase.from('profiles').update({ last_organization_id: orgId }).eq('id', userId);
            window.location.href = '/app';
        } catch (e) {
            console.error('Create Org Error:', e);
            alert(`事業所の作成に失敗しました: ${getErrorMessage(e)}`);
            setSubmitting(false);
        }
    };

    const handleJoinOrg = async () => {
        if (!inviteCode.trim()) return;
        setSubmitting(true);
        try {
            // 1. 招待コード検証
            const { data: invite, error: inviteError } = await supabase
                .from('invitations')
                .select('*')
                .eq('code', inviteCode)
                .eq('is_used', false)
                .single();

            if (inviteError || !invite) {
                alert('無効な招待コード、または既に使用されています');
                setSubmitting(false);
                return;
            }

            // 2. 既にその事業所のメンバーかチェック (重複エラー回避)
            const { data: existingMember } = await supabase
                .from('organization_members')
                .select('id')
                .eq('organization_id', invite.organization_id)
                .eq('user_id', userId)
                .maybeSingle();

            if (existingMember) {
                // 既に参加済みの場合は、その事業所に切り替えて移動
                await supabase.from('profiles').update({ last_organization_id: invite.organization_id }).eq('id', userId);
                alert('すでにこの事業所に参加しています。移動します。');
                window.location.href = '/app';
                return;
            }

            // 3. メンバー追加
            const { error: memberError } = await supabase
                .from('organization_members')
                .insert({
                    organization_id: invite.organization_id,
                    user_id: userId,
                    role: invite.role
                });

            if (memberError) throw memberError;

            // 4. 招待を使用済みに更新
            await supabase.from('invitations').update({ is_used: true }).eq('id', invite.id);

            // 5. 担当割り当て (あれば)
            if (invite.target_client_ids && invite.target_client_ids.length > 0) {
                const assignments = invite.target_client_ids.map((clientId: string) => ({
                    helper_id: userId,
                    client_id: clientId
                }));
                await supabase.from('assignments').insert(assignments);
            }

            // 参加した事業所を「最後に選択した事業所」として保存
            await supabase.from('profiles').update({ last_organization_id: invite.organization_id }).eq('id', userId);

            // 完了
            window.location.href = '/app';
        } catch (e) {
            console.error('Join Org Error:', e);
            alert(`参加に失敗しました: ${getErrorMessage(e)}`);
            setSubmitting(false);
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', p: 2 }}>
            <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 480, borderRadius: 3, border: '1px solid #ddd' }}>
                
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
                                    <Box sx={{ p: 1, bgcolor: '#e3f2fd', borderRadius: '50%', color: 'primary.main' }}>
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
                                    <Box sx={{ p: 1, bgcolor: '#f3e5f5', borderRadius: '50%', color: 'secondary.main' }}>
                                        <GroupAddIcon />
                                    </Box>
                                    <Box>
                                        <Typography fontWeight="bold">既存の事業所に参加する</Typography>
                                        <Typography variant="caption" color="text.secondary">招待コードをお持ちの方はこちら</Typography>
                                    </Box>
                                </Stack>
                            </CardActionArea>
                        </Card>

                        {/* ★追加: 既存メンバーの場合はキャンセルボタンを表示 */}
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