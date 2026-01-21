'use client';

import { useEffect, useState } from 'react';
import { 
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress, Stack, Divider, 
  Chip 
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import SaveIcon from '@mui/icons-material/Save';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LinkIcon from '@mui/icons-material/Link';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { callGasApi } from '@/app/actions/gas';
import { useToast } from '@/components/ui/ToastProvider';

export default function SettingsPage() {
    const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
    const router = useRouter();
    const { showToast } = useToast();

    const [orgName, setOrgName] = useState('');
    const [googleFolderId, setGoogleFolderId] = useState<string | null>(null);
    const [driveUrl, setDriveUrl] = useState('');
    
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            if (currentOrg.role !== 'owner') {
                router.push('/app'); 
                return;
            }
            fetchOrgDetails();
        }
    }, [wsLoading, currentOrg, router]);

    const fetchOrgDetails = async () => {
        if (!currentOrg) return;
        const { data } = await supabase
            .from('organizations')
            .select('name, google_folder_id')
            .eq('id', currentOrg.id)
            .single();
        
        if (data) {
            setOrgName(data.name);
            setGoogleFolderId(data.google_folder_id);
            if(data.google_folder_id) {
                setDriveUrl(`https://drive.google.com/drive/folders/${data.google_folder_id}`);
            }
        }
    };

    const handleSave = async () => {
        if (!orgName.trim() || !currentOrg) return;
        setSaving(true);
        try {
            const { error } = await supabase.from('organizations').update({ name: orgName }).eq('id', currentOrg.id);
            if (error) throw error;
            
            // フォルダがある場合、GAS側の名前も更新を試みる
            if (googleFolderId) {
                const { data: { user } } = await supabase.auth.getUser();
                await callGasApi({
                    action: 'manage_org_folder',
                    orgName: orgName,
                    orgId: currentOrg.id,
                    userEmail: user?.email,
                    currentFolderId: googleFolderId
                });
            }

            setMessage({ type: 'success', text: '更新しました' });
            refreshWorkspace();
        } catch (error) { 
            console.error(error); 
            setMessage({ type: 'error', text: '更新失敗' }); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleConnectDrive = async () => {
        if (!currentOrg) return;
        setConnecting(true);
        setMessage(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            
            const result = await callGasApi({
                action: 'manage_org_folder',
                orgName: orgName,
                orgId: currentOrg.id,
                userEmail: user?.email,
                currentFolderId: googleFolderId
            });

            if (result.status === 'success') {
                const newFolderId = result.folderId;
                
                await supabase
                    .from('organizations')
                    .update({ google_folder_id: newFolderId })
                    .eq('id', currentOrg.id);

                setGoogleFolderId(newFolderId);
                setDriveUrl(result.folderUrl);
                showToast('Googleドライブと連携しました');

                if (result.shareStatus === 'failed') {
                    alert(`フォルダは作成されましたが、権限付与に失敗しました。\nGoogleアカウントではない可能性があります。\nフォルダURLから手動でアクセス権を確認してください。\n\n${result.shareMessage}`);
                }
            } else {
                throw new Error(result.message);
            }
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: '連携に失敗しました。GASの設定を確認してください。' });
        } finally {
            setConnecting(false);
        }
    };

    if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
                <SettingsIcon sx={{ color: 'action.active', mr: 2 }} />
                <Typography variant="h6" fontWeight="bold" color="text.primary">事業所設定</Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
                <Box sx={{ maxWidth: 800, mx: 'auto' }}>
                    {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                    <Stack spacing={3}>
                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                            <Typography variant="h6" fontWeight="bold" gutterBottom>基本情報</Typography>
                            <Stack spacing={4}>
                                <Box>
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>事業所名</Typography>
                                    <TextField fullWidth value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                                </Box>
                                <Divider />
                                <Box textAlign="right">
                                    <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                                        {saving ? '保存中...' : '変更を保存'}
                                    </Button>
                                </Box>
                            </Stack>
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, borderColor: googleFolderId ? 'primary.light' : 'divider', bgcolor: googleFolderId ? '#F0F5FF' : '#fff' }}>
                            <Stack direction="row" alignItems="center" gap={2} mb={2}>
                                <CloudQueueIcon color="primary" fontSize="large" />
                                <Box>
                                    <Typography variant="h6" fontWeight="bold">Googleドライブ連携</Typography>
                                    <Typography variant="body2" color="text.secondary">帳票の保存先フォルダを管理します</Typography>
                                </Box>
                                {googleFolderId ? (
                                    <Chip label="連携済み" color="success" size="small" icon={<LinkIcon />} sx={{ ml: 'auto' }} />
                                ) : (
                                    <Chip label="未連携" color="default" size="small" sx={{ ml: 'auto' }} />
                                )}
                            </Stack>
                            
                            <Box sx={{ mt: 2, p: 2, bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                                {googleFolderId ? (
                                    <Stack spacing={2}>
                                        <Typography variant="body2">
                                            連携中のフォルダID: <code>{googleFolderId}</code>
                                        </Typography>
                                        <Stack direction="row" spacing={2}>
                                            <Button variant="outlined" href={driveUrl} target="_blank" startIcon={<LinkIcon />}>
                                                フォルダを開く
                                            </Button>
                                            <Button color="warning" onClick={handleConnectDrive} disabled={connecting}>
                                                フォルダを再作成/修復
                                            </Button>
                                        </Stack>
                                    </Stack>
                                ) : (
                                    <Stack spacing={2}>
                                        <Alert severity="info">
                                            まだ連携フォルダがありません。ボタンを押すと、管理者のGoogleドライブ内にこの事業所用のフォルダが自動作成されます。
                                        </Alert>
                                        <Button variant="contained" onClick={handleConnectDrive} disabled={connecting}>
                                            {connecting ? '作成中...' : '連携フォルダを作成する'}
                                        </Button>
                                    </Stack>
                                )}
                            </Box>
                        </Paper>
                    </Stack>
                </Box>
            </Box>
        </Box>
    );
}