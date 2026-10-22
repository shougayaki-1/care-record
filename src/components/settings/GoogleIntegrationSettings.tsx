'use client';

import { Alert, Box, Chip, CircularProgress, LinearProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton } from '@/components/ui';
import BuildIcon from '@mui/icons-material/Build';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SyncIcon from '@mui/icons-material/Sync';
import { GOOGLE_CONNECTION_LABELS, googleConnectionMessage } from '@/utils/googleSync';
import type { GoogleConnectionState } from '@/app/actions/google';

type GoogleIntegrationSettingsProps = {
  orgName: string;
  googleFolderId: string | null;
  googleCalendarId: string | null;
  googleConnectionState: GoogleConnectionState;
  driveUrl: string;
  canManageIntegrations: boolean;
  canRepairCalendarSync: boolean;
  connecting: boolean;
  connectingCal: boolean;
  repairingCal: boolean;
  resyncingCal: boolean;
  syncStatus: { total: number; unsynced: number } | null;
  syncProgress: { total: number; current: number } | null;
  handleConnectDrive: () => void | Promise<void>;
  handleDisconnectDrive: () => void | Promise<void>;
  handleConnectCalendar: (mode?: 'connect' | 'reauthorize') => void | Promise<void>;
  handleDisconnectCalendar: () => void | Promise<void>;
  handleRepairCalendar: () => void | Promise<void>;
  handleForceResyncCalendar: () => void | Promise<void>;
};

export function GoogleIntegrationSettings({ orgName, googleFolderId, googleCalendarId, googleConnectionState, driveUrl, canManageIntegrations, canRepairCalendarSync, connecting, connectingCal, repairingCal, resyncingCal, syncStatus, syncProgress, handleConnectDrive, handleDisconnectDrive, handleConnectCalendar, handleDisconnectCalendar, handleRepairCalendar, handleForceResyncCalendar }: GoogleIntegrationSettingsProps) {
  return (
    <Stack spacing={3}>
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
                <Chip
                    label={googleCalendarId ? GOOGLE_CONNECTION_LABELS[googleConnectionState] : '未連携'}
                    color={googleCalendarId && googleConnectionState === 'healthy' ? 'success' : googleCalendarId ? 'warning' : 'default'}
                    size="small"
                    icon={<LinkIcon />}
                    sx={{ ml: { sm: 'auto' } }}
                />
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
                            {googleConnectionMessage(googleConnectionState) && (
                                <Alert severity="warning">
                                    {googleConnectionMessage(googleConnectionState)}
                                </Alert>
                            )}
                            {canRepairCalendarSync && syncStatus && (
                                syncStatus.unsynced > 0 ? (
                                    <Alert severity="warning" sx={{ mt: 1 }}>
                                        未同期の予定が <strong>{syncStatus.unsynced} 件</strong> あります（全 {syncStatus.total} 件中）。「未同期を同期」で解消できます。
                                    </Alert>
                                ) : googleConnectionState === 'healthy' ? (
                                    <Alert severity="success" sx={{ mt: 1 }}>
                                        すべての予定（{syncStatus.total} 件）がGoogleカレンダーと同期済みです。
                                    </Alert>
                                ) : null
                            )}

                            {canRepairCalendarSync && syncProgress && (
                                <Box sx={{ mt: 1 }}>
                                    <LinearProgress aria-label="Googleカレンダー同期の進捗" variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} sx={{ height: 6, borderRadius: 1 }} />
                                    <Typography variant="caption" color="text.secondary">{syncProgress.current} / {syncProgress.total} 件 処理中...</Typography>
                                </Box>
                            )}

                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mt: 1, '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
                                {canRepairCalendarSync && <AppButton
                                    intent="warning"
                                    startIcon={repairingCal ? <CircularProgress size={16} color="inherit" aria-hidden /> : <BuildIcon />}
                                    onClick={handleRepairCalendar}
                                    disabled={repairingCal || resyncingCal || (syncStatus?.unsynced === 0)}
                                >
                                    {repairingCal ? '同期中...' : `未同期を同期${syncStatus && syncStatus.unsynced > 0 ? `（${syncStatus.unsynced}件）` : ''}`}
                                </AppButton>}
                                {/* 全件強制再同期（通常は未同期同期で十分。Google側で予定がずれた場合の最終手段） */}
                                {canRepairCalendarSync && <AppButton
                                    variant="outlined"
                                    startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" aria-hidden /> : <SyncIcon />}
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
                                <AppButton
                                    variant="outlined"
                                    intent="warning"
                                    onClick={() => handleConnectCalendar('reauthorize')}
                                    disabled={connectingCal || repairingCal || resyncingCal}
                                >
                                    {connectingCal ? 'Googleへ移動中...' : 'Googleを再認証'}
                                </AppButton>
                            </Stack>
                        </Stack>
                    ) : (
                        <Stack spacing={2}>
                            <Alert severity="info">
                                ボタンを押すとGoogleの認証画面へ移動します。許可すると、あなたのアカウントに事業所専用のGoogleカレンダーが自動作成され、以降のシフトが自動同期されます。
                            </Alert>
                            <AppButton intent="success" onClick={() => handleConnectCalendar()} disabled={connectingCal} sx={{ width: { xs: '100%', sm: 'auto' } }}>
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
    </Stack>
  );
}
