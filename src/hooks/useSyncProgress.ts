'use client';
import { getActionErrorMessage } from '@/utils/actionResult';
import { repairResultNotice, syncResultNotice } from '@/utils/calendarSyncRunner';
import { useCalendarSync } from './useCalendarSync';

type UseSyncProgressParams = {
    currentOrg: { id: string } | null;
    showToast: (msg: string, severity?: 'success' | 'info' | 'warning' | 'error') => void;
    confirm: (options: { message: string; title?: string; confirmText?: string; confirmColor?: 'primary' | 'error' | 'warning' }) => Promise<boolean>;
    setUnsyncedCount: (count: number) => void;
    onDataRefresh: () => void;
};

export const useSyncProgress = ({ currentOrg, showToast, confirm, setUnsyncedCount, onDataRefresh }: UseSyncProgressParams) => {
    const disconnectedMessage = 'Googleカレンダーが連携されていません。設定画面から接続してください。';
    const sync = useCalendarSync(currentOrg?.id, {
        checkConnection: true,
        refreshAlways: false,
        reportAfterRefresh: true,
        onDisconnected: () => showToast(disconnectedMessage, 'warning'),
        onEmpty: () => {},
        onSyncResult: result => {
            const notice = syncResultNotice(result, '再同期してください。');
            showToast(notice.message, notice.severity);
        },
        onRepairResult: result => {
            const notice = repairResultNotice(result, disconnectedMessage);
            showToast(notice.message, notice.severity);
        },
        onStatus: status => setUnsyncedCount(status.unsynced),
        onDataRefresh,
        onError: error => showToast(getActionErrorMessage(error), 'error'),
        confirmRepair: () => confirm({ message: 'Googleカレンダーの同期状態を修復します。既存予定の再リンク、重複削除、削除済みシフトのGoogle側削除を行います。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。' }),
    });
    return {
        syncProgress: sync.syncProgress,
        setSyncProgress: sync.setSyncProgress,
        repairingFromBanner: sync.repairing,
        resyncingCal: sync.resyncing,
        runUnsyncedSyncLoop: sync.runUnsyncedSyncLoop,
        runForceSyncLoop: sync.runForceSyncLoop,
        refreshUnsyncedCount: sync.refreshStatus,
        handleRepairFromBanner: sync.handleRepair,
        handleForceResyncCalendar: sync.handleForceResync,
    };
};
