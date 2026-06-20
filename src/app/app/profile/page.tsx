'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Alert, Stack, Divider,
    Container, Chip, CircularProgress, Avatar, IconButton
} from '@/components/ui/mui';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import LinkIcon from '@mui/icons-material/Link';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import PhotoCamera from '@mui/icons-material/PhotoCamera';
import { supabase } from '@/lib/supabase';
import { validatePassword, PASSWORD_POLICY_HINT } from '@/utils/passwordPolicy';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { deleteUserAccount, updateOwnProfile, uploadOwnAvatar } from '@/app/actions/user';

const GoogleLogo = () => (
    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
);
const MicrosoftLogo = () => (
    <svg width="20" height="20" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
);

type UserIdentity = { provider: string; };

export default function ProfilePage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const confirm = useConfirm();
    
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const [email, setEmail] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [name, setName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
    
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => { fetchProfile(); }, []);

    const fetchProfile = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setEmail(user.email || '');
            if (user.identities) {
                const identities = user.identities as unknown as UserIdentity[];
                setLinkedProviders(identities.map((id) => id.provider));
            }
            const { data: profile } = await supabase.from('profiles').select('name, avatar_url').eq('id', user.id).maybeSingle();
            if (profile) {
                setName(profile.name);
                setAvatarUrl(profile.avatar_url);
            }
        } catch (error) { 
            console.error(error); 
        } finally { 
            setLoading(false); 
        }
    };

    // ★修正: error handlingの型をunknownにし、明示的にキャスト
    const handleUpdateProfile = async () => {
        setMessage(null);
        if (!name.trim()) return setMessage({ type: 'error', text: '名前を入力してください' });
        if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
            return setMessage({ type: 'error', text: 'パスワードが一致しません' });
        }
        if (newPassword) {
            const policy = validatePassword(newPassword);
            if (!policy.ok) return setMessage({ type: 'error', text: policy.message });
        }
        setSaving(true);
        try {
            await updateOwnProfile(name);
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
            const formData = new FormData();
            formData.set('avatar', event.target.files[0]);
            const { avatarUrl: nextAvatarUrl } = await uploadOwnAvatar(formData);
            setAvatarUrl(nextAvatarUrl);
            showToast('プロフィール画像を更新しました');
        } catch (e: unknown) { 
            console.error(e);
            if (e instanceof Error) showToast('アップロード失敗: ' + e.message, 'error'); 
        } finally { 
            setUploading(false); 
        }
    };

    const handleDeleteAccount = async () => {
        if (!(await confirm({ title: 'アカウントの退会', message: '本当に退会しますか？\nアカウントと関連データが完全に削除され、復元できません。', confirmText: '退会する', confirmColor: 'error' }))) return;
        try {
            await deleteUserAccount();
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
                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
                            <Box position="relative" display="inline-block" mb={2}>
                                <Avatar 
                                    src={avatarUrl || undefined} 
                                    sx={{ width: 100, height: 100, mx: 'auto', fontSize: 40, bgcolor: 'primary.main' }}
                                >
                                    {name[0] || '?'}
                                </Avatar>
                                <IconButton 
                                    color="primary" 
                                    component="label" 
                                    sx={{ position: 'absolute', bottom: 0, right: -10, bgcolor: 'white', boxShadow: 2, '&:hover': {bgcolor: '#f0f0f0'} }}
                                >
                                    <input hidden accept="image/*" type="file" onChange={handleAvatarUpload} />
                                    {uploading ? <CircularProgress size={24} /> : <PhotoCamera />}
                                </IconButton>
                            </Box>

                            <Box>
                                <Typography variant="subtitle1" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                    <PersonIcon color="primary" /> 基本情報
                                </Typography>
                                <Stack spacing={2} mt={1}>
                                    <TextField label="氏名" value={name} onChange={(e) => setName(e.target.value)} fullWidth required />
                                    {currentOrg && (
                                        <TextField label="現在の事業所での権限" value={currentOrg.role} disabled fullWidth size="small" helperText={`事業所: ${currentOrg.name}`} />
                                    )}
                                </Stack>
                            </Box>
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                <LockIcon color="primary" /> セキュリティ設定
                            </Typography>
                            
                            <Stack spacing={3} mt={2}>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" gutterBottom>メールアドレス変更</Typography>
                                    <Typography variant="body2" mb={1}>現在のメール: {email}</Typography>
                                    <Stack direction="row" spacing={1}>
                                        <TextField label="新しいメールアドレス" fullWidth size="small" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                                        <Button variant="outlined" onClick={handleUpdateEmail}>変更確認を送信</Button>
                                    </Stack>
                                </Box>

                                <Divider />

                                <Box>
                                    <Typography variant="caption" color="text.secondary" gutterBottom>パスワード変更</Typography>
                                    <Stack spacing={2}>
                                        <TextField label="新しいパスワード" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} fullWidth size="small" helperText={newPassword ? PASSWORD_POLICY_HINT : ''} />
                                        <TextField label="確認" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} fullWidth size="small" />
                                    </Stack>
                                </Box>
                            </Stack>
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                            <Box>
                                <Typography variant="subtitle1" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                    <LinkIcon color="primary" /> 外部アカウント連携
                                </Typography>
                                <Stack spacing={2} mt={1}>
                                    {['google', 'azure'].map(p => (
                                        <Box key={p} display="flex" justifyContent="space-between" alignItems="center" p={2} border="1px solid" borderColor="divider" borderRadius={2}>
                                            <Box display="flex" alignItems="center" gap={2}>
                                                {p === 'google' ? <GoogleLogo /> : <MicrosoftLogo />}
                                                <Typography fontWeight="bold" textTransform="capitalize">{p === 'azure' ? 'Microsoft' : 'Google'}</Typography>
                                            </Box>
                                            {linkedProviders.includes(p) ? <Chip label="連携済" color="success" size="small" icon={<CheckCircleIcon />} /> : 
                                            <Button variant="outlined" size="small" onClick={() => handleLinkIdentity(p as 'google' | 'azure')}>連携</Button>}
                                        </Box>
                                    ))}
                                </Stack>
                            </Box>
                        </Paper>

                        <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleUpdateProfile} disabled={saving} sx={{ py: 1.5 }}>
                            {saving ? '保存中...' : '設定を保存'}
                        </Button>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, borderColor: 'error.main', bgcolor: 'background.danger' }}>
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
