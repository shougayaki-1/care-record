'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, Typography, Paper, Button, Alert, Stack, Container, CircularProgress } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { deleteUserAccount } from '@/app/actions/user';

// 子コンポーネントをインポート
import { ProfileForm } from './_components/ProfileForm';
import { PasswordForm } from './_components/PasswordForm';
import { LinkedAccountsSection } from './_components/LinkedAccountsSection';

type UserIdentity = { provider: string; };

export default function ProfilePage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const { user: currentUser } = useCurrentUser();
    const userId = currentUser?.id || '';
    const email = currentUser?.email || '';

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const [name, setName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
    
    const [newEmail, setNewEmail] = useState(''); // ステートを追加
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const fetchProfile = useCallback(async () => {
        if (!currentUser) return;
        try {
            const { data: profile } = await supabase.from('profiles').select('name, avatar_url').eq('id', currentUser.id).single();
            if (profile) {
                setName(profile.name);
                setAvatarUrl(profile.avatar_url);
            }
            if (currentUser.identities) {
                const identities = currentUser.identities as unknown as UserIdentity[];
                setLinkedProviders(identities.map((id) => id.provider));
            }
        } catch (error) { 
            console.error(error); 
        } finally { 
            setLoading(false); 
        }
    }, [currentUser]);

    useEffect(() => {
        if (currentUser) {
            fetchProfile();
        }
    }, [currentUser, fetchProfile]);

    const handleUpdateProfile = async () => {
        setMessage(null);
        if (!name.trim()) return setMessage({ type: 'error', text: '名前を入力してください' });
        if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
            return setMessage({ type: 'error', text: 'パスワードが一致しません' });
        }
        setSaving(true);
        try {
            const { error } = await supabase.from('profiles').update({ name }).eq('id', userId);
            if (error) throw error;
            if (newPassword) {
                const { error: passError } = await supabase.auth.updateUser({ password: newPassword });
                if (passError) throw passError;
            }
            setMessage({ type: 'success', text: '更新しました' });
            setNewPassword(''); setConfirmPassword('');
        } catch (e: unknown) { 
            if (e instanceof Error) setMessage({ type: 'error', text: e.message }); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleUpdateEmail = async () => {
        if (!newEmail) return;
        setMessage(null);
        try {
            const { error } = await supabase.auth.updateUser({ email: newEmail });
            if (error) throw error;
            setMessage({ type: 'success', text: '確認メールを送信しました。新しいメールアドレスを確認してください。' });
            setNewEmail('');
        } catch(e: unknown) {
            if (e instanceof Error) setMessage({ type: 'error', text: e.message });
        }
    };

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files || event.target.files.length === 0) return;
        setUploading(true);
        try {
            const file = event.target.files[0];
            const fileExt = file.name.split('.').pop();
            const filePath = `${userId}/${Date.now()}.${fileExt}`;
            
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
            
            await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
            setAvatarUrl(data.publicUrl);
            showToast('プロフィール画像を更新しました');
        } catch (e: unknown) { 
            console.error(e);
            if (e instanceof Error) showToast('アップロード失敗: ' + e.message, 'error'); 
        } finally { 
            setUploading(false); 
        }
    };

    const handleDeleteAccount = async () => {
        if (!confirm('本当に退会しますか？\nアカウントと関連データが完全に削除され、復元できません。')) return;
        try {
            await deleteUserAccount(userId);
            await supabase.auth.signOut();
            window.location.href = '/';
        } catch(e: unknown) { 
            if (e instanceof Error) setMessage({ type: 'error', text: e.message }); 
        }
    };

    const handleLinkIdentity = async (provider: 'google' | 'azure') => {
        const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: `${window.location.origin}/app/profile` } });
        if (error) setMessage({ type: 'error', text: error.message });
    };

    if (loading || wsLoading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
                <AccountCircleIcon sx={{ color: 'action.active', mr: 2 }} />
                <Typography variant="h6" fontWeight="bold" color="text.primary">アカウント設定</Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
                <Container maxWidth="sm">
                    {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                    <Stack spacing={3}>
                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                            <ProfileForm 
                                name={name}
                                setName={setName}
                                avatarUrl={avatarUrl}
                                uploading={uploading}
                                currentOrg={currentOrg}
                                onAvatarUpload={handleAvatarUpload}
                            />
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                            <PasswordForm 
                                email={email}
                                newEmail={newEmail}
                                setNewEmail={setNewEmail}
                                newPassword={newPassword}
                                setNewPassword={setNewPassword}
                                confirmPassword={confirmPassword}
                                setConfirmPassword={setConfirmPassword}
                                onUpdateEmail={handleUpdateEmail}
                            />
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                            <LinkedAccountsSection 
                                linkedProviders={linkedProviders}
                                onLinkIdentity={handleLinkIdentity}
                            />
                        </Paper>

                        <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleUpdateProfile} disabled={saving} sx={{ py: 1.5 }}>
                            {saving ? '保存中...' : '設定を保存'}
                        </Button>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, borderColor: 'error.main', bgcolor: '#fff5f5' }}>
                            <Typography variant="h6" color="error" gutterBottom fontWeight="bold" display="flex" alignItems="center" gap={1}>
                                <DeleteForeverIcon /> 退会エリア
                            </Typography>
                            <Typography variant="body2" mb={2}>
                                アカウントを完全に削除します。参加している事業所の記録データは残りますが、あなたの個人情報は削除され、ログインできなくなります。
                            </Typography>
                            <Button color="error" variant="contained" onClick={handleDeleteAccount}>退会する</Button>
                        </Paper>
                    </Stack>
                </Container>
            </Box>
        </Box>
    );
}