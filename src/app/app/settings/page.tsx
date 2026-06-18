'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { 
  Box, Typography, Paper, TextField, Button, Alert, CircularProgress, LinearProgress, Stack, Divider,
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
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import BuildIcon from '@mui/icons-material/Build';
import SyncIcon from '@mui/icons-material/Sync'; // ★追加: 同期用のアイコンを追加

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { callGasApi } from '@/app/actions/gas';
import { deleteOrganization, leaveOrganization, getAuditLogs } from '@/app/actions/organization';
import { getSyncStatus, syncUnsyncedBatch, forceSyncBatch } from '@/app/actions/shift'; // 同期はチャンク方式のサーバーバッチに統一
import { useToast } from '@/components/ui/ToastProvider';
import { getGoogleAuthUrlAction } from '@/app/actions/google';

type AuditLog = {
    id: string;
    created_at: string;
    action_type: string;
    target_resource: string | null;
    details: Record<string, unknown> | null;
    profiles: { name: string } | null; 
};

type GasResponse = {
    status: string;
    folderId?: string;
    folderUrl?: string;
    calendarId?: string;
    message?: string;
    shareStatus?: string;
    shareMessage?: string;
};

// URLパラメータを扱うコンポーネントはSuspenseで囲む必要があるため、中身を分離
function SettingsContent() {
    const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();

    const [tabIndex, setTabIndex] = useState(0);
    const [orgName, setOrgName] = useState('');
    const [googleFolderId, setGoogleFolderId] = useState<string | null>(null);
    const [googleCalendarId, setGoogleCalendarId] = useState<string | null>(null);
    const [driveUrl, setDriveUrl] = useState('');
    
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectingCal, setConnectingCal] = useState(false);
    const [repairingCal, setRepairingCal] = useState(false);
    const [resyncingCal, setResyncingCal] = useState(false); // ★追加: 強制全件再同期中ステート
    const [syncStatus, setSyncStatus] = useState<{ total: number; unsynced: number } | null>(null);
    const [syncProgress, setSyncProgress] = useState<{ total: number; current: number } | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    
    const [logs, setLogs] = useState<AuditLog[]>([]);

    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    const [openLeaveDialog, setOpenLeaveDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState('');

    const fetchOrgDetails = useCallback(async () => {
        if (!currentOrg) return;
        const { data } = await supabase
            .from('organizations')
            .select('name, google_folder_id, google_calendar_id')
            .eq('id', currentOrg.id)
            .single();
        
        if (data) {
            setOrgName(data.name);
            setGoogleFolderId(data.google_folder_id);
            setGoogleCalendarId(data.google_calendar_id);
            if(data.google_folder_id) {
                setDriveUrl(`https://drive.google.com/drive/folders/${data.google_folder_id}`);
            }
        }
    }, [currentOrg]);

    const fetchLogs = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const data = await getAuditLogs(currentOrg.id);
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

    // Google OAuth コールバック後のトースト表示
    useEffect(() => {
        const successMsg = searchParams.get('success');
        const errorMsg = searchParams.get('error');
        
        if (successMsg === 'calendar_connected') {
            showToast('Googleカレンダーを作成し連携しました！', 'success');
            // パラメータを消去（replaceはエラーを防ぐため今回はシンプルにURLを上書き）
            window.history.replaceState(null, '', '/app/settings');
        } else if (errorMsg) {
            showToast(`連携に失敗しました (${errorMsg})`, 'error');
            window.history.replaceState(null, '', '/app/settings');
        }
    }, [searchParams, showToast]);

    const handleSave = async () => {
        if (!orgName.trim() || !currentOrg) return;
        setSaving(true);
        setMessage(null);
        try {
            const { error } = await supabase.from('organizations').update({ name: orgName }).eq('id', currentOrg.id);
            if (error) throw error;
            
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
            }) as GasResponse;

            if (result.status === 'success' && result.folderId) {
                const newFolderId = result.folderId;
                await supabase
                    .from('organizations')
                    .update({ google_folder_id: newFolderId })
                    .eq('id', currentOrg.id);

                setGoogleFolderId(newFolderId);
                if (result.folderUrl) setDriveUrl(result.folderUrl);
                showToast('Googleドライブと連携しました');
            } else {
                throw new Error(result.message || 'Unknown error');
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

    // OAuth認証によるカレンダー作成（Googleへ遷移）
    const handleConnectCalendar = async () => {
        if (!currentOrg) return;
        setConnectingCal(true);
        try {
            const url = await getGoogleAuthUrlAction(currentOrg.id);
            // Googleのログイン画面へリダイレクト
            window.location.href = url;
        } catch (e) {
            console.error(e);
            showToast('認証URLの取得に失敗しました', 'error');
            setConnectingCal(false);
        }
    };

    const handleDisconnectCalendar = async () => {
        if (!confirm('カレンダーの連携を解除しますか？\n（作成されたカレンダー自体はGoogleに残り、トークンのみ破棄されます）')) return;
        if (!currentOrg) return;
        try {
            await supabase.from('organizations').update({ 
                google_calendar_id: null,
                google_refresh_token: null // トークンも破棄
            }).eq('id', currentOrg.id);
            setGoogleCalendarId(null);
            showToast('連携を解除しました');
        } catch(e) { 
            console.error(e);
            showToast('解除に失敗しました', 'error'); 
        }
    };

    // 同期ステータス（未同期件数）を取得して表示を更新
    const refreshSyncStatus = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const s = await getSyncStatus(currentOrg.id);
            setSyncStatus({ total: s.total, unsynced: s.unsynced });
        } catch (e) {
            console.error('getSyncStatus error', e);
        }
    }, [currentOrg]);

    useEffect(() => {
        if (googleCalendarId) refreshSyncStatus();
        else setSyncStatus(null);
    }, [googleCalendarId, refreshSyncStatus]);

    // 同期結果のメッセージ
    const reportSyncResult = (done: number, failed: number, errorKind?: string) => {
        if (errorKind === 'auth') {
            showToast('Googleカレンダーの認証が切れています。「連携を解除」後に再接続してください。', 'error');
        } else if (failed > 0) {
            showToast(`同期が一部失敗しました（成功 ${done} 件 / 失敗 ${failed} 件）。通信状況を確認し、しばらくしてから再度お試しください。`, 'warning');
        } else {
            showToast(`Googleカレンダーへの同期が完了しました（${done} 件）。`, 'success');
        }
    };

    // 未同期シフトのみをチャンク単位で同期する
    const handleRepairCalendar = async () => {
        if (!currentOrg) return;
        setRepairingCal(true);
        try {
            const status = await getSyncStatus(currentOrg.id);
            const total = status.unsynced;
            if (total === 0) { showToast('未同期の予定はありません。', 'info'); return; }
            setSyncProgress({ total, current: 0 });
            let done = 0, failed = 0;
            let errorKind: string | undefined;
            for (;;) {
                const res = await syncUnsyncedBatch(currentOrg.id, 20);
                done += res.succeeded; failed += res.failed;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, done) });
                if (errorKind === 'auth' || res.remaining <= 0 || res.succeeded === 0) break;
            }
            reportSyncResult(done, failed, errorKind);
        } catch (e) {
            console.error(e);
            showToast('同期処理中にエラーが発生しました。', 'error');
        } finally {
            setRepairingCal(false);
            setSyncProgress(null);
            refreshSyncStatus();
        }
    };

    // 全件強制再同期をチャンク単位でループ実行する
    const handleForceResyncCalendar = async () => {
        if (!currentOrg) return;
        if (!confirm('全ての予定（既に同期済みの予定も含む）をGoogleカレンダーに強制的に再同期します。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。')) return;

        setResyncingCal(true);
        try {
            const status = await getSyncStatus(currentOrg.id);
            const total = status.total;
            if (total === 0) { showToast('同期対象の予定がありません。', 'info'); return; }
            setSyncProgress({ total, current: 0 });
            let cursor: string | null = null;
            let done = 0, failed = 0;
            let errorKind: string | undefined;
            for (;;) {
                const res = await forceSyncBatch(currentOrg.id, cursor, 20);
                done += res.processed; failed += res.failed; cursor = res.nextCursor;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, done) });
                if (errorKind === 'auth' || res.remaining <= 0 || res.processed === 0) break;
            }
            reportSyncResult(done, failed, errorKind);
        } catch (e) {
            console.error(e);
            showToast('全件再同期中にエラーが発生しました。', 'error');
        } finally {
            setResyncingCal(false);
            setSyncProgress(null);
            refreshSyncStatus();
        }
    };

    const handleDeleteOrg = async () => {
        if (!currentOrg || confirmInput !== currentOrg.name) return;
        try {
            await deleteOrganization(currentOrg.id);
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
            await leaveOrganization(currentOrg.id);
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
                                        <Typography variant="body2" color="text.secondary">帳票の保存先フォルダを管理します（GAS経由）</Typography>
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

                            {/* Googleカレンダー連携 (OAuth方式) */}
                            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, borderColor: googleCalendarId ? '#4caf50' : 'divider', bgcolor: googleCalendarId ? '#f1f8e9' : '#fff' }}>
                                <Stack direction="row" alignItems="center" gap={2} mb={2}>
                                    <CalendarMonthIcon color="success" fontSize="large" />
                                    <Box>
                                        <Typography variant="h6" fontWeight="bold">Googleカレンダー連携</Typography>
                                        <Typography variant="body2" color="text.secondary">事業所ごとの専用カレンダーを自動作成し、シフトを同期します（OAuth直接連携）</Typography>
                                    </Box>
                                    <Chip label={googleCalendarId ? "連携済み" : "未連携"} color={googleCalendarId ? "success" : "default"} size="small" icon={<LinkIcon />} sx={{ ml: 'auto' }} />
                                </Stack>
                                
                                <Box sx={{ mt: 2, p: 2, bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                                    {isOwner ? (
                                        googleCalendarId ? (
                                            <Stack spacing={2}>
                                                <Typography variant="body2">
                                                    連携中のカレンダーID: <code>{googleCalendarId}</code>
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    ※Googleカレンダーアプリから「CareRecord_{orgName}」という名前のカレンダーを確認してください。
                                                </Typography>

                                                {/* 同期ステータス */}
                                                {syncStatus && (
                                                    syncStatus.unsynced > 0 ? (
                                                        <Alert severity="warning" sx={{ mt: 1 }}>
                                                            未同期の予定が <strong>{syncStatus.unsynced} 件</strong> あります（全 {syncStatus.total} 件中）。「未同期を同期」で解消できます。
                                                        </Alert>
                                                    ) : (
                                                        <Alert severity="success" sx={{ mt: 1 }}>
                                                            すべての予定（{syncStatus.total} 件）がGoogleカレンダーと同期済みです。
                                                        </Alert>
                                                    )
                                                )}

                                                {syncProgress && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <LinearProgress variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
                                                        <Typography variant="caption" color="text.secondary">{syncProgress.current} / {syncProgress.total} 件 処理中...</Typography>
                                                    </Box>
                                                )}

                                                <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap', gap: 1.5 }}>
                                                    <Button
                                                        variant="contained"
                                                        color="warning"
                                                        startIcon={repairingCal ? <CircularProgress size={16} color="inherit" /> : <BuildIcon />}
                                                        onClick={handleRepairCalendar}
                                                        disabled={repairingCal || resyncingCal || (syncStatus?.unsynced === 0)}
                                                    >
                                                        {repairingCal ? '同期中...' : `未同期を同期${syncStatus && syncStatus.unsynced > 0 ? `（${syncStatus.unsynced}件）` : ''}`}
                                                    </Button>
                                                    {/* 全件強制再同期（通常は未同期同期で十分。Google側で予定がずれた場合の最終手段） */}
                                                    <Button
                                                        variant="outlined"
                                                        color="primary"
                                                        startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
                                                        onClick={handleForceResyncCalendar}
                                                        disabled={repairingCal || resyncingCal}
                                                        sx={{ boxShadow: 'none' }}
                                                    >
                                                        {resyncingCal ? '全件再同期中...' : '全件再同期'}
                                                    </Button>
                                                    <Button 
                                                        variant="outlined"
                                                        color="error" 
                                                        startIcon={<LinkOffIcon />} 
                                                        onClick={handleDisconnectCalendar} 
                                                        disabled={repairingCal || resyncingCal}
                                                    >
                                                        連携を解除
                                                    </Button>
                                                </Stack>
                                            </Stack>
                                        ) : (
                                            <Stack spacing={2}>
                                                <Alert severity="info">
                                                    ボタンを押すとGoogleの認証画面へ移動します。許可すると、あなたのアカウントに事業所専用のGoogleカレンダーが自動作成され、以降のシフトが自動同期されます。
                                                </Alert>
                                                <Button variant="contained" color="success" onClick={handleConnectCalendar} disabled={connectingCal}>
                                                    {connectingCal ? 'Googleへ移動中...' : 'シフト用カレンダーを作成・連携する'}
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

// メインのエクスポート（Suspenseでラップ）
export default function SettingsPage() {
    return (
        <Suspense fallback={<Box p={5} textAlign="center"><CircularProgress /></Box>}>
            <SettingsContent />
        </Suspense>
    );
}