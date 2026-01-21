'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress, Stack, Divider, 
  Chip, Tabs, Tab, Table, TableBody, TableCell, TableHead, TableRow, Dialog, 
  DialogTitle, DialogContent, DialogContentText, DialogActions
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import SaveIcon from '@mui/icons-material/Save';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LinkIcon from '@mui/icons-material/Link';
import ListAltIcon from '@mui/icons-material/ListAlt';
import WarningIcon from '@mui/icons-material/Warning';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import LinkOffIcon from '@mui/icons-material/LinkOff';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { callGasApi } from '@/app/actions/gas';
import { deleteOrganization, leaveOrganization, getAuditLogs } from '@/app/actions/organization';
import { useToast } from '@/components/ui/ToastProvider';

// 監査ログデータの型定義
type AuditLog = {
    id: string;
    created_at: string;
    action_type: string;
    target_resource: string | null;
    details: Record<string, unknown> | null;
    profiles: { name: string } | null; // Joinされたプロフィール情報
};

export default function SettingsPage() {
    const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
    const router = useRouter();
    const { showToast } = useToast();

    // State
    const [tabIndex, setTabIndex] = useState(0);
    const [orgName, setOrgName] = useState('');
    const [googleFolderId, setGoogleFolderId] = useState<string | null>(null);
    const [driveUrl, setDriveUrl] = useState('');
    
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    
    // ログの型を具体的に指定
    const [logs, setLogs] = useState<AuditLog[]>([]);

    // Dialogs
    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    const [openLeaveDialog, setOpenLeaveDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState('');

    const fetchOrgDetails = useCallback(async () => {
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
    }, [currentOrg]);

    const fetchLogs = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const data = await getAuditLogs(currentOrg.id);
            // 取得データをAuditLog[]型として扱う
            setLogs((data as unknown as AuditLog[]) || []);
        } catch (e) { console.error(e); }
    }, [currentOrg]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            if (currentOrg.role === 'staff') {
                router.push('/app');
                return;
            }
            fetchOrgDetails();
            fetchLogs();
        }
    }, [wsLoading, currentOrg, router, fetchOrgDetails, fetchLogs]);

    const handleSave = async () => {
        if (!orgName.trim() || !currentOrg) return;
        setSaving(true);
        setMessage(null);
        try {
            const { error } = await supabase.from('organizations').update({ name: orgName }).eq('id', currentOrg.id);
            if (error) throw error;
            
            // GAS側のフォルダ名更新を試みる
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

    const handleDisconnectDrive = async () => {
        if (!confirm('連携を解除しますか？\n（Googleドライブ上のフォルダは削除されません。アプリからの参照のみ解除されます。）')) return;
        if (!currentOrg) return;
        try {
            await supabase.from('organizations').update({ google_folder_id: null }).eq('id', currentOrg.id);
            setGoogleFolderId(null);
            showToast('連携を解除しました');
        } catch(e) { 
            console.error(e);
            showToast('解除に失敗しました', 'error'); 
        }
    };

    const handleDeleteOrg = async () => {
        if (!currentOrg || confirmInput !== currentOrg.name) return;
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if(!user) return;
            await deleteOrganization(currentOrg.id, user.id);
            showToast('事業所を削除しました');
            window.location.href = '/setup';
        } catch (e: unknown) { 
            console.error(e); 
            const msg = e instanceof Error ? e.message : String(e);
            showToast('削除失敗: ' + msg, 'error'); 
        }
    };

    const handleLeaveOrg = async () => {
        if (!currentOrg) return;
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if(!user) return;
            await leaveOrganization(currentOrg.id, user.id);
            showToast('事業所から脱退しました');
            window.location.href = '/setup';
        } catch (e: unknown) { 
            const msg = e instanceof Error ? e.message : String(e);
            showToast(msg, 'error'); 
        }
    };

    if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
    const isOwner = currentOrg.role === 'owner';

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: 'background.paper' }}>
                <Stack direction="row" alignItems="center" height={64} spacing={2}>
                    <SettingsIcon sx={{ color: 'action.active' }} />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">事業所設定</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="基本設定" />
                    {currentOrg.role !== 'staff' && <Tab label="操作ログ" icon={<ListAltIcon fontSize="small" />} iconPosition="start" />}
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
                <Box sx={{ maxWidth: 800, mx: 'auto' }}>
                    {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                    {tabIndex === 0 && (
                        <Stack spacing={3}>
                            {/* 基本情報 */}
                            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                                <Typography variant="h6" fontWeight="bold" gutterBottom>基本情報</Typography>
                                <Stack spacing={4}>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>事業所名</Typography>
                                        <TextField fullWidth value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!isOwner} />
                                    </Box>
                                    <Divider />
                                    {isOwner && (
                                        <Box textAlign="right">
                                            <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                                                {saving ? '保存中...' : '変更を保存'}
                                            </Button>
                                        </Box>
                                    )}
                                </Stack>
                            </Paper>

                            {/* Google Drive連携 */}
                            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, borderColor: googleFolderId ? 'primary.light' : 'divider', bgcolor: googleFolderId ? '#F0F5FF' : '#fff' }}>
                                <Stack direction="row" alignItems="center" gap={2} mb={2}>
                                    <CloudQueueIcon color="primary" fontSize="large" />
                                    <Box>
                                        <Typography variant="h6" fontWeight="bold">Googleドライブ連携</Typography>
                                        <Typography variant="body2" color="text.secondary">帳票の保存先フォルダを管理します</Typography>
                                    </Box>
                                    <Chip label={googleFolderId ? "連携済み" : "未連携"} color={googleFolderId ? "success" : "default"} size="small" icon={<LinkIcon />} sx={{ ml: 'auto' }} />
                                </Stack>
                                
                                <Box sx={{ mt: 2, p: 2, bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                                    {isOwner ? (
                                        googleFolderId ? (
                                            <Stack spacing={2}>
                                                <Typography variant="body2">
                                                    連携中のフォルダID: <code>{googleFolderId}</code>
                                                </Typography>
                                                <Stack direction="row" spacing={2}>
                                                    <Button variant="outlined" href={driveUrl} target="_blank" startIcon={<LinkIcon />}>
                                                        フォルダを開く
                                                    </Button>
                                                    <Button color="error" startIcon={<LinkOffIcon />} onClick={handleDisconnectDrive}>
                                                        連携を解除
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
                                        )
                                    ) : (
                                        <Typography variant="caption" color="text.secondary">
                                            管理者のみ設定を変更できます。
                                        </Typography>
                                    )}
                                </Box>
                            </Paper>

                            {/* 危険な設定 */}
                            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, borderColor: 'error.light', bgcolor: '#fff5f5' }}>
                                <Stack direction="row" alignItems="center" gap={1} mb={2}>
                                    <WarningIcon color="error" />
                                    <Typography variant="h6" fontWeight="bold" color="error">危険な設定</Typography>
                                </Stack>
                                <Stack spacing={2}>
                                    <Box display="flex" justifyContent="space-between" alignItems="center">
                                        <Box>
                                            <Typography fontWeight="bold">事業所から脱退</Typography>
                                            <Typography variant="caption" color="text.secondary">この事業所のメンバーから外れます</Typography>
                                        </Box>
                                        <Button variant="outlined" color="warning" startIcon={<ExitToAppIcon />} onClick={() => setOpenLeaveDialog(true)}>
                                            脱退する
                                        </Button>
                                    </Box>
                                    {isOwner && (
                                        <>
                                            <Divider />
                                            <Box display="flex" justifyContent="space-between" alignItems="center">
                                                <Box>
                                                    <Typography fontWeight="bold" color="error">事業所を削除</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        全てのデータ（利用者、記録、スタッフ情報）が永久に削除されます。<br/>
                                                        この操作は取り消せません。
                                                    </Typography>
                                                </Box>
                                                <Button variant="contained" color="error" onClick={() => { setConfirmInput(''); setOpenDeleteDialog(true); }}>
                                                    削除する
                                                </Button>
                                            </Box>
                                        </>
                                    )}
                                </Stack>
                            </Paper>
                        </Stack>
                    )}

                    {tabIndex === 1 && (
                        <Paper variant="outlined">
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>日時</TableCell>
                                        <TableCell>操作者</TableCell>
                                        <TableCell>操作内容</TableCell>
                                        <TableCell>対象</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {logs.length === 0 ? (
                                        <TableRow><TableCell colSpan={4} align="center">ログはありません</TableCell></TableRow>
                                    ) : (
                                        logs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                                                <TableCell>{log.profiles?.name || '不明'}</TableCell>
                                                <TableCell>{log.action_type}</TableCell>
                                                <TableCell>{log.target_resource || '-'}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Paper>
                    )}
                </Box>
            </Box>

            {/* 削除確認ダイアログ */}
            <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)}>
                <DialogTitle>事業所の完全削除</DialogTitle>
                <DialogContent>
                    <DialogContentText color="error" sx={{ mb: 2 }}>
                        本当に削除しますか？この操作は取り消せません。<br/>
                        確認のため、事業所名 <b>{currentOrg.name}</b> を入力してください。
                    </DialogContentText>
                    <TextField 
                        fullWidth 
                        size="small" 
                        value={confirmInput} 
                        onChange={e => setConfirmInput(e.target.value)} 
                        placeholder={currentOrg.name} 
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenDeleteDialog(false)}>キャンセル</Button>
                    <Button 
                        onClick={handleDeleteOrg} 
                        color="error" 
                        variant="contained" 
                        disabled={confirmInput !== currentOrg.name}
                    >
                        削除実行
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 脱退確認ダイアログ */}
            <Dialog open={openLeaveDialog} onClose={() => setOpenLeaveDialog(false)}>
                <DialogTitle>脱退の確認</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        本当にこの事業所から脱退しますか？<br/>
                        オーナー権限を持っている場合は、事前に他のメンバーへ権限を譲渡する必要があります。
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenLeaveDialog(false)}>キャンセル</Button>
                    <Button onClick={handleLeaveOrg} color="warning" variant="contained">脱退する</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}