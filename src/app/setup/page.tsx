'use client';

import { useState, useEffect, Suspense } from 'react';
import { Box, Paper, CircularProgress, Alert, Typography } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

// 子コンポーネント
import { ProfileStep } from './_components/ProfileStep';
import { ChoiceStep } from './_components/ChoiceStep';
import { CreateStep } from './_components/CreateStep';
import { JoinStep } from './_components/JoinStep';

type Step = 'profile' | 'choice' | 'create' | 'join';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function SetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramInviteCode = searchParams.get('inviteCode');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<Step>('profile');
  const [userId, setUserId] = useState('');
  const [hasMembership, setHasMembership] = useState(false);

  const [userName, setUserName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    if (paramInviteCode) setInviteCode(paramInviteCode);
  }, [paramInviteCode]);

  useEffect(() => {
    let mounted = true;
    let processedUserId: string | null = null;

    const processUser = async (user: User) => {
      if (!mounted) return;
      if (processedUserId === user.id) return;
      processedUserId = user.id;

      setUserId(user.id);

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .single();

        if (profileError && profileError.code !== 'PGRST116') {
          console.error('[SetupPage] Profile fetch error:', profileError);
        }

        const { data: members, error: membersError } = await supabase
          .from('organization_members')
          .select('id')
          .eq('user_id', user.id);

        if (membersError) {
          console.error('[SetupPage] Membership fetch error:', membersError);
        }

        const isMember = !!members && members.length > 0;
        setHasMembership(isMember);

        if (isMember) {
          if (!mounted) return;
          setLoading(false);
          router.replace('/app');
          return;
        }

        if (profile?.name) {
          setUserName(profile.name);
          setStep(paramInviteCode ? 'join' : 'choice');
        } else {
          setStep('profile');
        }

        if (mounted) setLoading(false);
      } catch (err) {
        console.error('[SetupPage] Setup error:', err);
        if (mounted) setLoading(false);
      }
    };

    const initSetup = async () => {
      try {
        const first = await supabase.auth.getUser();
        if (!mounted) return;

        if (first.data.user) {
          await processUser(first.data.user);
          return;
        }

        // OAuth直後の反映遅延を1回だけ吸収
        await sleep(600);
        if (!mounted) return;

        const retry = await supabase.auth.getUser();
        if (!mounted) return;

        if (retry.data.user) {
          await processUser(retry.data.user);
          return;
        }

        if (mounted) {
          setLoading(false);
          router.replace('/');
        }
      } catch (err) {
        console.error('[SetupPage] initSetup error:', err);
        if (mounted) {
          setLoading(false);
          router.replace('/');
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            await processUser(session.user);
          }
        }

        if (event === 'SIGNED_OUT') {
          setLoading(false);
          router.replace('/');
        }
      }
    );

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
      const { error } = await supabase.from('profiles').upsert({
        id: userId,
        name: userName,
        is_agreed: true,
        agreed_at: new Date().toISOString(),
      });

      if (error) throw error;

      setStep(paramInviteCode ? 'join' : 'choice');
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
        org_name: orgName,
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
          role: invite.role,
        });

      if (memberError) throw memberError;

      await supabase.from('invitations').update({ is_used: true }).eq('id', invite.id);

      if (invite.target_client_ids && invite.target_client_ids.length > 0) {
        const assignments = invite.target_client_ids.map((clientId: string) => ({
          helper_id: userId,
          client_id: clientId,
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

  if (loading) {
    return (
      <Box p={5} textAlign="center">
        <CircularProgress />
        <Typography mt={2}>セットアップ情報を取得中...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', p: 2 }}>
      <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 480, borderRadius: 3, border: '1px solid #ddd' }}>
        {step === 'join' && paramInviteCode && (
          <Alert severity="info" sx={{ mb: 3 }}>
            招待コードが検出されました。<br />新しい事業所に参加しますか？
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
            onBack={() => (paramInviteCode ? router.push('/app') : setStep('choice'))}
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