'use client';

import { Box, Stack, Typography, Chip, Alert, Button, CircularProgress } from '@mui/material';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import BuildIcon from '@mui/icons-material/Build';
import SyncIcon from '@mui/icons-material/Sync';

interface Props {
    orgName: string;
    googleFolderId: string | null;
    googleCalendarId: string | null;
    driveUrl: string;
    isOwner: boolean;
    connecting: boolean;
    connectingCal: boolean;
    repairingCal: boolean;
    resyncingCal: boolean;
    onConnectDrive: () => Promise<void>;
    onDisconnectDrive: () => Promise<void>;
    onConnectCalendar: () => Promise<void>;
    onDisconnectCalendar: () => Promise<void>;
    onRepairCalendar: () => Promise<void>;
    onForceResyncCalendar: () => Promise<void>;
}

export function GoogleIntegrationTab({
    orgName, googleFolderId, googleCalendarId, driveUrl, isOwner,
    connecting, connectingCal, repairingCal, resyncingCal,
    onConnectDrive, onDisconnectDrive, onConnectCalendar, onDisconnectCalendar,
    onRepairCalendar, onForceResyncCalendar
}: Props) {
    return (
        <Stack spacing={4}>
            {/* --- Googleドライブ連携 --- */}
            <Box p={3} border="1px solid" borderColor={googleFolderId ? 'primary.light' : 'divider'} borderRadius={3} sx={{ bgcolor: googleFolderId ? '#F0F5FF' : '#fff' }}>
                <Stack direction="row" alignItems="center" gap={2} mb={2} flexWrap="wrap">
                    <CloudQueueIcon color="primary" fontSize="large" />
                    <Box>
                        <Typography variant="h6" fontWeight="bold">Googleドライブ連携</Typography>
                        <Typography variant="body2" color="text.secondary">帳票の保存先フォルダを管理します（GAS経由）</Typography>
                    </Box>
                    <Chip 
                        label={googleFolderId ? "連携済み" : "未連携"} 
                        color={googleFolderId ? "success" : "default"} 
                        size="small" 
                        icon={<LinkIcon />} 
                        sx={{ ml: 'auto' }} 
                    />
                </Stack>
                
                <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    {isOwner ? (
                        googleFolderId ? (
                            <Stack spacing={2}>
                                <Typography variant="body2">
                                    連携中のフォルダID: <code>{googleFolderId}</code>
                                </Typography>
                                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap gap={1.5}>
                                    <Button variant="outlined" href={driveUrl} target="_blank" startIcon={<LinkIcon />}>
                                        フォルダを開く
                                    </Button>
                                    <Button color="error" startIcon={<LinkOffIcon />} onClick={onDisconnectDrive}>
                                        連携を解除
                                    </Button>
                                    <Button color="warning" onClick={onConnectDrive} disabled={connecting}>
                                        フォルダを再作成/修復
                                    </Button>
                                </Stack>
                            </Stack>
                        ) : (
                            <Stack spacing={2}>
                                <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
                                    まだ連携フォルダがありません。ボタンを押すと、管理者のGoogleドライブ内にこの事業所用のフォルダが自動作成されます。
                                </Alert>
                                <Button variant="contained" onClick={onConnectDrive} disabled={connecting}>
                                    {connecting ? '作成中...' : '連携フォルダを作成する'}
                                </Button>
                            </Stack>
                        )
                    ) : (
                        <Typography variant="caption" color="text.secondary">管理者のみ設定を変更できます。</Typography>
                    )}
                </Box>
            </Box>

            {/* --- Googleカレンダー連携 --- */}
            <Box p={3} border="1px solid" borderColor={googleCalendarId ? '#4caf50' : 'divider'} borderRadius={3} sx={{ bgcolor: googleCalendarId ? '#f1f8e9' : '#fff' }}>
                <Stack direction="row" alignItems="center" gap={2} mb={2} flexWrap="wrap">
                    <CalendarMonthIcon color="success" fontSize="large" />
                    <Box>
                        <Typography variant="h6" fontWeight="bold">Googleカレンダー連携</Typography>
                        <Typography variant="body2" color="text.secondary">事業所ごとの専用カレンダーを自動作成し、シフトを同期します（OAuth直接連携）</Typography>
                    </Box>
                    <Chip 
                        label={googleCalendarId ? "連携済み" : "未連携"} 
                        color={googleCalendarId ? "success" : "default"} 
                        size="small" 
                        icon={<LinkIcon />} 
                        sx={{ ml: 'auto' }} 
                    />
                </Stack>
                
                <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    {isOwner ? (
                        googleCalendarId ? (
                            <Stack spacing={2}>
                                <Typography variant="body2">
                                    連携中のカレンダーID: <code>{googleCalendarId}</code>
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    ※Googleカレンダーアプリから「CareRecord_{orgName}」という名前のカレンダーを確認してください。
                                </Typography>
                                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap gap={1.5}>
                                    <Button 
                                        variant="contained" 
                                        color="warning" 
                                        startIcon={repairingCal ? <CircularProgress size={16} color="inherit" /> : <BuildIcon />} 
                                        onClick={onRepairCalendar} 
                                        disabled={repairingCal || resyncingCal}
                                    >
                                        {repairingCal ? '同期修復中...' : '未同期のみ修復'}
                                    </Button>
                                    <Button 
                                        variant="contained" 
                                        color="primary" 
                                        startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />} 
                                        onClick={onForceResyncCalendar} 
                                        disabled={repairingCal || resyncingCal}
                                        sx={{ boxShadow: 'none' }}
                                    >
                                        {resyncingCal ? '全件再同期中...' : '全件強制再同期'}
                                    </Button>
                                    <Button 
                                        variant="outlined"
                                        color="error" 
                                        startIcon={<LinkOffIcon />} 
                                        onClick={onDisconnectCalendar} 
                                        disabled={repairingCal || resyncingCal}
                                    >
                                        連携を解除
                                    </Button>
                                </Stack>
                            </Stack>
                        ) : (
                            <Stack spacing={2}>
                                <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
                                    ボタンを押すとGoogleの認証画面へ移動します。許可すると、あなたのアカウントに事業所専用のGoogleカレンダーが自動作成され、以降のシフトが自動同期されます。
                                </Alert>
                                <Button variant="contained" color="success" onClick={onConnectCalendar} disabled={connectingCal}>
                                    {connectingCal ? 'Googleへ移動中...' : 'シフト用カレンダーを作成・連携する'}
                                </Button>
                            </Stack>
                        )
                    ) : (
                        <Typography variant="caption" color="text.secondary">管理者のみ設定を変更できます。</Typography>
                    )}
                </Box>
            </Box>
        </Stack>
    );
}