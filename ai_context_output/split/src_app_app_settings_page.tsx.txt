'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { checkManagementPermission, checkShiftPermission } from '@/utils/permissions';
import { 
  Box, Typography, Alert, CircularProgress, LinearProgress, Stack, Divider,
  Chip, Tabs, Tab, Table, TableBody, TableCell, TableHead, TableRow
} from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, DateTimeField, NumberField, PageBody, PageLayout } from '@/components/ui';
import SettingsIcon from '@mui/icons-material/Settings';
import SaveIcon from '@mui/icons-material/Save';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LinkIcon from '@mui/icons-material/Link';
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
import { deleteOrganization, disconnectGoogleCalendar, getAuditLogs, exportAuditLogsCsv, leaveOrganization, updateOrganizationDriveFolder, updateOrganizationName, updateTravelCostSettings } from '@/app/actions/organization';
import { getSyncStatus, syncUnsyncedBatch, repairGoogleCalendarSync } from '@/app/actions/shift'; // 同期はチャンク方式のサーバーバッチに統一
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { getGoogleAuthUrlAction } from '@/app/actions/google';
import LaborPremiumSettings from '@/components/settings/LaborPremiumSettings';
import ServiceTypeSettings from '@/components/settings/ServiceTypeSettings';
import StaffRoleSettings from '@/components/settings/StaffRoleSettings';

type AuditLog = {
    id: string;
    created_at: string;
    action_type: string;
    resource_id: string | null;
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
    const confirm = useConfirm();

    const [tabIndex, setTabIndex] = useState(0);
    const [orgName, setOrgName] = useState('');
    const [googleFolderId, setGoogleFolderId] = useState<string | null>(null);
    const [googleCalendarId, setGoogleCalendarId] = useState<string | null>(null);
    const [driveUrl, setDriveUrl] = useState('');
    const [travelCostRate, setTravelCostRate] = useState('20');
    
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectingCal, setConnectingCal] = useState(false);
    const [repairingCal, setRepairingCal] = useState(false);
    const [resyncingCal, setResyncingCal] = useState(false); // ★追加: 強制全件再同期中ステート
    const [syncStatus, setSyncStatus] = useState<{ total: number; unsynced: number } | null>(null);
    const [syncProgress, setSyncProgress] = useState<{ total: number; current: number } | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [logFrom, setLogFrom] = useState('');
    const [logTo, setLogTo] = useState('');

    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    const [openLeaveDialog, setOpenLeaveDialog] = useState(false);
    const [confirmInput, setConfirmInput] = useState('');
    const canRepairCalendarSync = Boolean(
        currentOrg &&
        checkShiftPermission(currentOrg.effectivePermissions, 'edit', true) &&
        currentOrg.effectivePermissions.shifts.edit === 'all'
    );

    const fetchOrgDetails = useCallback(async () => {
        if (!currentOrg) return;
        const { data } = await supabase
            .from('organizations')
            .select('name, google_folder_id, google_calendar_id, travel_cost_rate_yen_per_km')
            .eq('id', currentOrg.id)
            .single();
        
        if (data) {
            setOrgName(data.name);
            setGoogleFolderId(data.google_folder_id);
            setGoogleCalendarId(data.google_calendar_id);
            setTravelCostRate(String(data.travel_cost_rate_yen_per_km ?? 20));
            if(data.google_folder_id) {
                setDriveUrl(`https://drive.google.com/drive/folders/${data.google_folder_id}`);
            }
        }
    }, [currentOrg]);

    const fetchLogs = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const data = await getAuditLogs(currentOrg.id, {
                from: logFrom ? new Date(logFrom).toISOString() : null,
                to: logTo ? new Date(logTo).toISOString() : null,
            });
            setLogs((data as unknown as AuditLog[]) || []);
        } catch (e) { console.error(e); }
    }, [currentOrg, logFrom, logTo]);

    const handleExportLogs = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { filename, csv } = await exportAuditLogsCsv(currentOrg.id, {
                from: logFrom ? new Date(logFrom).toISOString() : null,
                to: logTo ? new Date(logTo).toISOString() : null,
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
            URL.revokeObjectURL(url);
        } catch (e) { console.error(e); }
    }, [currentOrg, logFrom, logTo]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            if (!Object.values(currentOrg.effectivePermissions.management).some(Boolean)) {
                router.push('/app');
                return;
            }
            fetchOrgDetails();
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
            await updateOrganizationName(currentOrg.id, orgName);
            
            if (googleFolderId) {
                const { data: { user } } = await supabase.auth.getUser();
                await callGasApi({
                    action: 'manage_org_folder',
                    organizationId: currentOrg.id,
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
                organizationId: currentOrg.id,
                orgName: orgName,
                orgId: currentOrg.id,
                userEmail: user?.email,
                currentFolderId: googleFolderId
            }) as GasResponse;

            if (result.status === 'success' && result.folderId) {
                const newFolderId = result.folderId;
                await updateOrganizationDriveFolder(currentOrg.id, newFolderId);

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

    const handleSaveTravelCost = async () => {
        if (!currentOrg) return;
        setSaving(true);
        setMessage(null);
        try {
            await updateTravelCostSettings(currentOrg.id, Number(travelCostRate));
            setMessage({ type: 'success', text: '交通費設定を保存しました' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: e instanceof Error ? e.message : '保存失敗' });
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnectDrive = async () => {
        if (!(await confirm({ message: '連携を解除しますか？\n（Googleドライブ上のフォルダは削除されません。アプリからの参照のみ解除されます。）', confirmText: '解除する', confirmColor: 'warning' }))) return;
        if (!currentOrg) return;
        try {
            await updateOrganizationDriveFolder(currentOrg.id, null);
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
        if (!(await confirm({ message: 'カレンダーの連携を解除しますか？\n（作成されたカレンダー自体はGoogleに残り、トークンのみ破棄されます）', confirmText: '解除する', confirmColor: 'warning' }))) return;
        if (!currentOrg) return;
        try {
            await disconnectGoogleCalendar(currentOrg.id);
            setGoogleCalendarId(null);
            showToast('連携を解除しました');
        } catch(e) { 
            console.error(e);
            showToast('解除に失敗しました', 'error'); 
        }
    };

    // 同期ステータス（未同期件数）を取得して表示を更新
    const refreshSyncStatus = useCallback(async () => {
        if (!currentOrg || !canRepairCalendarSync) return;
        try {
            const s = await getSyncStatus(currentOrg.id);
            setSyncStatus({ total: s.total, unsynced: s.unsynced });
        } catch (e) {
            console.error('getSyncStatus error', e);
        }
    }, [currentOrg, canRepairCalendarSync]);

    useEffect(() => {
        if (googleCalendarId && canRepairCalendarSync) refreshSyncStatus();
        else setSyncStatus(null);
    }, [googleCalendarId, canRepairCalendarSync, refreshSyncStatus]);

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

    const reportRepairResult = (res: Awaited<ReturnType<typeof repairGoogleCalendarSync>>) => {
        if (!res.connected) {
            showToast('Googleカレンダーが連携されていません。「連携する」から接続してください。', 'warning');
        } else if (res.errorKind === 'auth') {
            showToast('Googleカレンダーの認証が切れています。「連携を解除」後に再接続してください。', 'error');
        } else if (res.failed > 0) {
            showToast(`同期修復が一部失敗しました（成功 ${res.succeeded} 件 / 失敗 ${res.failed} 件）。`, 'warning');
        } else {
            showToast(`同期修復が完了しました（作成 ${res.created} / 更新 ${res.updated} / 再リンク ${res.linked} / 重複削除 ${res.deduped} / Google削除 ${res.deletedRemote}）。`, 'success');
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
        if (!(await confirm({ message: 'Googleカレンダーの同期状態を修復します。既存予定の再リンク、重複削除、削除済みシフトのGoogle側削除を行います。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。' }))) return;

        setResyncingCal(true);
        try {
            setSyncProgress({ total: 1, current: 0 });
            const res = await repairGoogleCalendarSync(currentOrg.id);
            setSyncProgress({ total: 1, current: 1 });
            reportRepairResult(res);
        } catch (e) {
            console.error(e);
            showToast('同期修復中にエラーが発生しました。', 'error');
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
    const canEditOrganization = checkManagementPermission(currentOrg.effectivePermissions, 'organization');
    const canManageIntegrations = checkManagementPermission(currentOrg.effectivePermissions, 'integrations');
    const canDeleteOrganization = currentOrg.role === 'owner' && checkManagementPermission(currentOrg.effectivePermissions, 'organizationDelete');

    return (
        <PageLayout>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 2, sm: 3 }, bgcolor: 'background.paper' }}>
                <Stack direction="row" alignItems="center" height={64} spacing={2}>
                    <SettingsIcon sx={{ color: 'action.active' }} />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">事業所設定</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="scrollable" allowScrollButtonsMobile>
                    <Tab label="基本設定" />
                </Tabs>
            </Box>

            <PageBody maxWidth={800}>
                    {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                    {tabIndex === 0 && (
                        <Stack spacing={3}>
                            {/* 基本情報 */}
                            <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                <Typography variant="h6" fontWeight="bold" gutterBottom>基本情報</Typography>
                                <Stack spacing={4}>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>事業所名</Typography>
                                        <AppTextField value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!canEditOrganization} />
                                    </Box>
                                    <Divider />
                                    {canEditOrganization && (
                                        <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
                                            <AppButton size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                                                {saving ? '保存中...' : '変更を保存'}
                                            </AppButton>
                                        </Box>
                                    )}
                                </Stack>
                            </Box>

                            {/* 交通費設定 */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>交通費設定</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        記録画面の交通費は、往復距離 × 1kmあたり単価で算出します。
                                    </Typography>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
                                        <NumberField
                                            label="1kmあたり単価"
                                            value={travelCostRate}
                                            onChange={(e) => setTravelCostRate(e.target.value)}
                                            sx={{ maxWidth: { sm: 240 } }}
                                            slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">円/km</Typography> }, htmlInput: { inputMode: 'decimal', step: '1', min: 0 } }}
                                        />
                                        <AppButton startIcon={<SaveIcon />} onClick={handleSaveTravelCost} disabled={saving}>
                                            保存
                                        </AppButton>
                                    </Stack>
                                </Box>
                            )}

                            {/* Google Drive連携 */}
                            <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, borderColor: googleFolderId ? 'primary.light' : 'divider', bgcolor: googleFolderId ? 'background.tint' : 'background.paper' }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} mb={2}>
                                    <CloudQueueIcon color="primary" fontSize="large" />
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="h6" fontWeight="bold">Googleドライブ連携</Typography>
                                        <Typography variant="body2" color="text.secondary">帳票の保存先フォルダを管理します（GAS経由）</Typography>
                                    </Box>
                                    <Chip label={googleFolderId ? "連携済み" : "未連携"} color={googleFolderId ? "success" : "default"} size="small" icon={<LinkIcon />} sx={{ ml: { sm: 'auto' } }} />
                                </Stack>
                                
                                <Box sx={{ mt: 2, p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                                    {canManageIntegrations ? (
                                        googleFolderId ? (
                                            <Stack spacing={2}>
                                                <Typography variant="body2">
                                                    連携中のフォルダID:{' '}
                                                    <Box component="code" sx={{ display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-all', verticalAlign: 'bottom' }}>
                                                        {googleFolderId}
                                                    </Box>
                                                </Typography>
                                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap" sx={{ '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
                                                    <AppButton variant="outlined" intent="secondary" href={driveUrl} target="_blank" rel="noreferrer" startIcon={<LinkIcon />}>
                                                        フォルダを開く
                                                    </AppButton>
                                                    <AppButton variant="text" intent="danger" startIcon={<LinkOffIcon />} onClick={handleDisconnectDrive}>
                                                        連携を解除
                                                    </AppButton>
                                                    <AppButton variant="text" intent="warning" onClick={handleConnectDrive} disabled={connecting}>
                                                        フォルダを再作成/修復
                                                    </AppButton>
                                                </Stack>
                                            </Stack>
                                        ) : (
                                            <Stack spacing={2}>
                                                <Alert severity="info">
                                                    まだ連携フォルダがありません。ボタンを押すと、管理者のGoogleドライブ内にこの事業所用のフォルダが自動作成されます。
                                                </Alert>
                                                <AppButton onClick={handleConnectDrive} disabled={connecting} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                                                    {connecting ? '作成中...' : '連携フォルダを作成する'}
                                                </AppButton>
                                            </Stack>
                                        )
                                    ) : (
                                        <Typography variant="caption" color="text.secondary">
                                            連携設定権限を持つメンバーのみ設定を変更できます。
                                        </Typography>
                                    )}
                                </Box>
                            </Box>

                            {/* Googleカレンダー連携 (OAuth方式) */}
                            <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, borderColor: googleCalendarId ? 'success.main' : 'divider', bgcolor: googleCalendarId ? 'background.success' : 'background.paper' }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} mb={2}>
                                    <CalendarMonthIcon color="success" fontSize="large" />
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="h6" fontWeight="bold">Googleカレンダー連携</Typography>
                                        <Typography variant="body2" color="text.secondary">事業所ごとの専用カレンダーを自動作成し、シフトを同期します（OAuth直接連携）</Typography>
                                    </Box>
                                    <Chip label={googleCalendarId ? "連携済み" : "未連携"} color={googleCalendarId ? "success" : "default"} size="small" icon={<LinkIcon />} sx={{ ml: { sm: 'auto' } }} />
                                </Stack>
                                
                                <Box sx={{ mt: 2, p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                                    {canManageIntegrations ? (
                                        googleCalendarId ? (
                                            <Stack spacing={2}>
                                                <Typography variant="body2">
                                                    連携中のカレンダーID:{' '}
                                                    <Box component="code" sx={{ display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-all', verticalAlign: 'bottom' }}>
                                                        {googleCalendarId}
                                                    </Box>
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    ※Googleカレンダーアプリから「CareRecord_{orgName}」という名前のカレンダーを確認してください。
                                                </Typography>

                                                {/* 同期ステータス */}
                                                {canRepairCalendarSync && syncStatus && (
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

                                                {canRepairCalendarSync && syncProgress && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <LinearProgress variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} sx={{ height: 6, borderRadius: 1 }} />
                                                        <Typography variant="caption" color="text.secondary">{syncProgress.current} / {syncProgress.total} 件 処理中...</Typography>
                                                    </Box>
                                                )}

                                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mt: 1, '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
                                                    {canRepairCalendarSync && <AppButton
                                                        intent="warning"
                                                        startIcon={repairingCal ? <CircularProgress size={16} color="inherit" /> : <BuildIcon />}
                                                        onClick={handleRepairCalendar}
                                                        disabled={repairingCal || resyncingCal || (syncStatus?.unsynced === 0)}
                                                    >
                                                        {repairingCal ? '同期中...' : `未同期を同期${syncStatus && syncStatus.unsynced > 0 ? `（${syncStatus.unsynced}件）` : ''}`}
                                                    </AppButton>}
                                                    {/* 全件強制再同期（通常は未同期同期で十分。Google側で予定がずれた場合の最終手段） */}
                                                    {canRepairCalendarSync && <AppButton
                                                        variant="outlined"
                                                        startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
                                                        onClick={handleForceResyncCalendar}
                                                        disabled={repairingCal || resyncingCal}
                                                        sx={{ boxShadow: 'none' }}
                                                    >
                                                        {resyncingCal ? '修復中...' : '同期を修復'}
                                                    </AppButton>}
                                                    <AppButton
                                                        variant="outlined"
                                                        intent="danger"
                                                        startIcon={<LinkOffIcon />} 
                                                        onClick={handleDisconnectCalendar} 
                                                        disabled={repairingCal || resyncingCal}
                                                    >
                                                        連携を解除
                                                    </AppButton>
                                                </Stack>
                                            </Stack>
                                        ) : (
                                            <Stack spacing={2}>
                                                <Alert severity="info">
                                                    ボタンを押すとGoogleの認証画面へ移動します。許可すると、あなたのアカウントに事業所専用のGoogleカレンダーが自動作成され、以降のシフトが自動同期されます。
                                                </Alert>
                                                <AppButton intent="success" onClick={handleConnectCalendar} disabled={connectingCal} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                                                    {connectingCal ? 'Googleへ移動中...' : 'シフト用カレンダーを作成・連携する'}
                                                </AppButton>
                                            </Stack>
                                        )
                                    ) : (
                                        <Typography variant="caption" color="text.secondary">
                                            連携設定権限を持つメンバーのみ設定を変更できます。
                                        </Typography>
                                    )}
                                </Box>
                            </Box>

                            {/* 労働時間ルール */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>労働時間ルール</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        深夜割り増し・時間外割り増しなどの種別と計算方法を管理します。
                                    </Typography>
                                    <LaborPremiumSettings orgId={currentOrg.id} />
                                </Box>
                            )}

                            {/* サービス種別 */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>サービス種別</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        シフト内の区間に設定できるサービス種別（例：重度訪問介護、移動支援）を管理します。
                                    </Typography>
                                    <ServiceTypeSettings orgId={currentOrg.id} />
                                </Box>
                            )}

                            {/* スタッフ役割 */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>スタッフ役割</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        シフト区間内でのスタッフの役割（例：正職員、パート、ボランティア）を管理します。無給フラグを設定することで給与計算から除外できます。
                                    </Typography>
                                    <StaffRoleSettings orgId={currentOrg.id} />
                                </Box>
                            )}

                            {/* 危険な設定 */}
                            <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, borderColor: 'error.light', bgcolor: 'background.danger' }}>
                                <Stack direction="row" alignItems="center" gap={1} mb={2}>
                                    <WarningIcon color="error" />
                                    <Typography variant="h6" fontWeight="bold" color="error">危険な設定</Typography>
                                </Stack>
                                <Stack spacing={2}>
                                    <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} flexDirection={{ xs: 'column', sm: 'row' }} gap={1.5}>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography fontWeight="bold">事業所から脱退</Typography>
                                            <Typography variant="caption" color="text.secondary">この事業所のメンバーから外れます</Typography>
                                        </Box>
                                        <AppButton variant="outlined" intent="warning" startIcon={<ExitToAppIcon />} onClick={() => setOpenLeaveDialog(true)}>
                                            脱退する
                                        </AppButton>
                                    </Box>
                                    {canDeleteOrganization && (
                                        <>
                                            <Divider />
                                            <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} flexDirection={{ xs: 'column', sm: 'row' }} gap={1.5}>
                                                <Box sx={{ minWidth: 0 }}>
                                                    <Typography fontWeight="bold" color="error">事業所を削除</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        全てのデータ（利用者、記録、スタッフ情報）が永久に削除されます。<br/>
                                                        この操作は取り消せません。
                                                    </Typography>
                                                </Box>
                                                <AppButton intent="danger" onClick={() => { setConfirmInput(''); setOpenDeleteDialog(true); }}>
                                                    削除する
                                                </AppButton>
                                            </Box>
                                        </>
                                    )}
                                </Stack>
                            </Box>
                        </Stack>
                    )}

                    {tabIndex === 1 && (
                        <Box>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ p: 2 }}>
                                <DateTimeField kind="date" label="開始日" size="small" value={logFrom} onChange={(e) => setLogFrom(e.target.value)} />
                                <DateTimeField kind="date" label="終了日" size="small" value={logTo} onChange={(e) => setLogTo(e.target.value)} />
                                <AppButton variant="outlined" intent="secondary" onClick={fetchLogs}>絞り込み</AppButton>
                                <Box sx={{ flexGrow: 1 }} />
                                <AppButton onClick={handleExportLogs}>CSVエクスポート</AppButton>
                            </Stack>
                            <Divider />
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
                                                <TableCell>{log.resource_id || '-'}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Box>
                    )}
            </PageBody>

            <AppDialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)} title="事業所の完全削除" dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenDeleteDialog(false)}>キャンセル</AppButton><AppButton onClick={handleDeleteOrg} intent="danger" disabled={confirmInput !== currentOrg.name}>削除実行</AppButton></>}>
                    <Typography color="error" sx={{ mb: 2 }}>
                        本当に削除しますか？この操作は取り消せません。<br/>
                        確認のため、事業所名 <b>{currentOrg.name}</b> を入力してください。
                    </Typography>
                    <AppTextField
                        fullWidth 
                        size="small" 
                        value={confirmInput} 
                        onChange={e => setConfirmInput(e.target.value)} 
                        placeholder={currentOrg.name} 
                    />
            </AppDialog>

            <AppDialog open={openLeaveDialog} onClose={() => setOpenLeaveDialog(false)} title="脱退の確認" dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenLeaveDialog(false)}>キャンセル</AppButton><AppButton onClick={handleLeaveOrg} intent="warning">脱退する</AppButton></>}>
                    <Typography>
                        本当にこの事業所から脱退しますか？<br/>
                        オーナー権限を持っている場合は、事前に他のメンバーへ権限を譲渡する必要があります。
                    </Typography>
            </AppDialog>
        </PageLayout>
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
