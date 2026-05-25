'use client';

import { useState, useEffect, Suspense } from 'react';
import { Box, Paper, CircularProgress, Alert, Typography } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

// 子コンポーネントをインポート
import { ProfileStep } from './_components/ProfileStep';
import { ChoiceStep } from './_components/ChoiceStep';
import { CreateStep } from './_components/CreateStep';
import { JoinStep } from './_components/JoinStep';

type Step = 'profile' | 'choice' | 'create' | 'join';

function SetupContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const paramInviteCode = searchParams.get('inviteCode');

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState<Step>('profile');
    const [userId, setUserId] = useState('');
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
            setUserId(user.id);

            try {
                // 1. プロファイル情報の取得
                const { data: profile, error: profileError } = await supabase.from('profiles').select('name').eq('id', user.id).single();
                
                if (profileError && profileError.code !== 'PGRST116') {
                    console.error('[SetupPage] Profile fetch error:', profileError);
                }

                // 2. 所属組織の確認
                const { data: members } = await supabase.from('organization_members').select('id').eq('user_id', user.id);
                const isMember = members && members.length > 0;
                setHasMembership(isMember || false);

                // 3. すでに組織に所属しているユーザーの場合、直接アプリ（/app）へ転送
                if (isMember) {
                    console.log('[SetupPage] User is already a member. Autoredirecting to app...');
                    if (mounted) {
                        setLoading(false);
                        router.replace('/app');
                    }
                    return;
                }

                // 4. 新規ユーザーの場合はステップの切り替え
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

        // 初期マウント時に getUser() を使って安全かつ確実に認証判定を行う
        const initSetup = async () => {
            console.log('[SetupPage] Checking user session via getUser...');
            const { data: { user } } = await supabase.auth.getUser();

            if (!mounted) return;

            if (user) {
                console.log('[SetupPage] User confirmed via getUser:', user.id);
                await processUser(user);
            } else {
                console.log('[SetupPage] No active session. Redirecting to login.');
                setLoading(false);
                router.replace('/');
            }
        };

        // 認証状態の変化を監視。初期の不安定な INITIAL_SESSION null は無視する
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log(`[SetupPage] Auth Event: ${event}, Session exists: ${!!session}`);
            
            if (!mounted) return;

            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                if (session) {
                    await processUser(session.user);
                }
            } else if (event === 'SIGNED_OUT') {
                console.log('[SetupPage] SIGNED_OUT detected. Redirecting to login.');
                setLoading(false);
                router.replace('/');
            }
        });

        initSetup();

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [router, paramInviteCode]);

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

            const { data: existingMember } = await supabase
                .from('organization_members')
                .select('id')
                .eq('organization_id', invite.organization_id)
                .eq('user_id', userId)
                .maybeSingle();

            if (existingMember) {
                await supabase.from('profiles').update({ last_organization_id: invite.organization_id }).eq('id', userId);
                alert('すでにこの事業所に参加しています。移動します。');
                window.location.href = '/app';
                return;
            }

            const { error: memberError } = await supabase
                .from('organization_members')
                .insert({
                    organization_id: invite.organization_id,
                    user_id: userId,
                    role: invite.role
                });

            if (memberError) throw memberError;

            await supabase.from('invitations').update({ is_used: true }).eq('id', invite.id);

            if (invite.target_client_ids && invite.target_client_ids.length > 0) {
                const assignments = invite.target_client_ids.map((clientId: string) => ({
                    helper_id: userId,
                    client_id: clientId
                }));
                await supabase.from('assignments').insert(assignments);
            }

            await supabase.from('profiles').update({ last_organization_id: invite.organization_id }).eq('id', userId);

            window.location.href = '/app';
        } catch (e) {
            console.error('Join Org Error:', e);
            alert(`参加に失敗しました: ${getErrorMessage(e)}`);
            setSubmitting(false);
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /><Typography mt={2}>セットアップ情報を取得中...</Typography></Box>;

    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', p: 2 }}>
            <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 480, borderRadius: 3, border: '1px solid #ddd' }}>
                
                {step === 'join' && paramInviteCode && (
                    <Alert severity="info" sx={{ mb: 3 }}>
                        招待コードが検出されました。<br/>新しい事業所に参加しますか？
                    </Alert>
                )}

                {step === 'profile' && (
                    <ProfileStep 
                        userName={userName}
                        setUserName={setUserName}
                        onNext={handleSaveProfile}
                        submitting={submitting}
                    />
                )}

                {step === 'choice' && (
                    <ChoiceStep 
                        setStep={setStep}
                        hasMembership={hasMembership}
                        onBackToApp={() => router.push('/app')}
                    />
                )}

                {step === 'create' && (
                    <CreateStep 
                        orgName={orgName}
                        setOrgName={setOrgName}
                        onCreate={handleCreateOrg}
                        onBack={() => setStep('choice')}
                        submitting={submitting}
                    />
                )}

                {step === 'join' && (
                    <JoinStep 
                        inviteCode={inviteCode}
                        setInviteCode={setInviteCode}
                        onJoin={handleJoinOrg}
                        onBack={() => paramInviteCode ? router.push('/app') : setStep('choice')}
                        submitting={submitting}
                    />
                )}

            </Paper>
        </Box>
    );
}

export default function SetupPage() {
    return (
        <Suspense fallback={<Box p={5} textAlign="center"><CircularProgress /></Box>}>
            <SetupContent />
        </Suspense>
    );
}