'use client';

import { useEffect, useCallback, Suspense } from 'react';
import { Box, Typography, Paper, CircularProgress, Stack, Tabs, Tab, Alert } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import ListAltIcon from '@mui/icons-material/ListAlt';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';

// 分割コンポーネント・Hooksのインポート
import { GeneralSettingsTab } from './_components/GeneralSettingsTab';
import { GoogleIntegrationTab } from './_components/GoogleIntegrationTab';
import { AuditLogTab } from './_components/AuditLogTab';
import { DangerZoneTab } from './_components/DangerZoneTab';
import { useSettingsPage } from './_hooks/useSettingsPage';

function SettingsContent() {
    const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();

    // ビジネスロジックを抽出したカスタムフックを適用
    const {
        tabIndex,
        setTabIndex,
        orgName,
        setOrgName,
        googleFolderId,
        googleCalendarId,
        driveUrl,
        saving,
        connecting,
        connectingCal,
        repairingCal,
        resyncingCal,
        message,
        logs,
        openDeleteDialog,
        setOpenDeleteDialog,
        openLeaveDialog,
        setOpenLeaveDialog,
        confirmInput,
        setConfirmInput,
        fetchOrgDetails,
        fetchLogs,
        handleSave,
        handleConnectDrive,
        handleDisconnectDrive,
        handleConnectCalendar,
        handleDisconnectCalendar,
        handleRepairCalendar,
        handleForceResyncCalendar,
        handleDeleteOrg,
        handleLeaveOrg
    } = useSettingsPage(currentOrg, refreshWorkspace);

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

    useEffect(() => {
        const successMsg = searchParams.get('success');
        const errorMsg = searchParams.get('error');
        
        // 4. 同期Cascading render警告を防ぐため、setTimeoutでマクロタスク処理に逃がす
        const timer = setTimeout(() => {
            if (successMsg === 'calendar_connected') {
                showToast('Googleカレンダーを作成し連携しました！', 'success');
                window.history.replaceState(null, '', '/app/settings');
            } else if (errorMsg) {
                showToast(`連携に失敗しました (${errorMsg})`, 'error');
                window.history.replaceState(null, '', '/app/settings');
            }
        }, 0);

        return () => clearTimeout(timer);
    }, [searchParams, showToast]);

    if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;
    const isOwner = currentOrg.role === 'owner';

    const handleConfirmDisconnectDrive = async () => {
        if (confirm('連携を解除しますか？\n（Googleドライブ上のフォルダは削除されません。アプリからの参照のみ解除されます。）')) {
            await handleDisconnectDrive();
        }
    };

    const handleConfirmDisconnectCalendar = async () => {
        if (confirm('カレンダーの連携を解除しますか？\n（作成されたカレンダー自体はGoogleに残り、トークンのみ破棄されます）')) {
            await handleDisconnectCalendar();
        }
    };

    const handleConfirmRepairCalendar = async () => {
        if (confirm('Googleカレンダーへの同期漏れ（未同期）になっている予定を検出し、一括で再接続（修復）します。よろしいですか？')) {
            await handleRepairCalendar();
        }
    };

    const handleConfirmForceResyncCalendar = async () => {
        if (confirm('すべての予定をGoogleカレンダーに強制的に再同期します。よろしいですか？')) {
            await handleForceResyncCalendar();
        }
    };

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
                        <Stack spacing={4}>
                            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                                <GeneralSettingsTab 
                                    orgName={orgName}
                                    setOrgName={setOrgName}
                                    isOwner={isOwner}
                                    saving={saving}
                                    onSave={handleSave}
                                />
                            </Paper>

                            <GoogleIntegrationTab 
                                orgName={orgName}
                                googleFolderId={googleFolderId}
                                googleCalendarId={googleCalendarId}
                                driveUrl={driveUrl}
                                isOwner={isOwner}
                                connecting={connecting}
                                connectingCal={connectingCal}
                                repairingCal={repairingCal}
                                resyncingCal={resyncingCal}
                                onConnectDrive={handleConnectDrive}
                                onDisconnectDrive={handleConfirmDisconnectDrive}
                                onConnectCalendar={handleConnectCalendar}
                                onDisconnectCalendar={handleConfirmDisconnectCalendar}
                                onRepairCalendar={handleConfirmRepairCalendar}
                                onForceResyncCalendar={handleConfirmForceResyncCalendar}
                            />

                            <DangerZoneTab 
                                orgName={currentOrg.name}
                                isOwner={isOwner}
                                confirmInput={confirmInput}
                                setConfirmInput={setConfirmInput}
                                openDeleteDialog={openDeleteDialog}
                                setOpenDeleteDialog={setOpenDeleteDialog}
                                openLeaveDialog={openLeaveDialog}
                                setOpenLeaveDialog={setOpenLeaveDialog}
                                onDeleteOrg={handleDeleteOrg}
                                onLeaveOrg={handleLeaveOrg}
                            />
                        </Stack>
                    )}

                    {tabIndex === 1 && (
                        <Paper variant="outlined" sx={{ p: 1, borderRadius: 3 }}>
                            <AuditLogTab logs={logs} />
                        </Paper>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<Box p={5} textAlign="center"><CircularProgress /></Box>}>
            <SettingsContent />
        </Suspense>
    );
}