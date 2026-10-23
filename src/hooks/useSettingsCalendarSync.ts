'use client';
import { useState } from 'react';
import { repairResultNotice, syncResultNotice } from '@/utils/calendarSyncRunner';
import { useCalendarSync } from './useCalendarSync';

type Params = {
    organizationId?: string;
    canRepair: boolean;
    showToast: (message: string, severity?: 'success' | 'info' | 'warning' | 'error') => void;
    confirm: (options: { message: string }) => Promise<boolean>;
};

export function useSettingsCalendarSync({ organizationId, canRepair, showToast, confirm }: Params) {
    const [status, setStatus] = useState<{ organizationId?: string; total: number; unsynced: number } | null>(null);
    const disconnectedMessage = 'Googleカレンダーが連携されていません。「連携する」から接続してください。';
    const sync = useCalendarSync(organizationId, {
        checkConnection: false,
        refreshEnabled: canRepair,
        onRefreshError: error => console.error('getSyncStatus error', error),
        refreshAlways: true,
        refreshInBackground: true,
        reportAfterRefresh: false,
        onDisconnected: () => showToast(disconnectedMessage, 'warning'),
        onEmpty: () => showToast('未同期の予定はありません。', 'info'),
        onSyncResult: result => {
            const notice = syncResultNotice(result, '再度お試しください。');
            showToast(notice.message, notice.severity);
        },
        onRepairResult: result => {
            const notice = repairResultNotice(result, disconnectedMessage);
            showToast(notice.message, notice.severity);
        },
        onStatus: value => setStatus({ organizationId, ...value }),
        onDataRefresh: () => {},
        onError: (error, repair) => {
            console.error(error);
            showToast(repair ? '同期修復中にエラーが発生しました。' : '同期処理中にエラーが発生しました。', 'error');
        },
        confirmRepair: () => confirm({ message: 'Googleカレンダーの同期状態を修復します。既存予定の再リンク、重複削除、削除済みシフトのGoogle側削除を行います。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。' }),
    });
    const refreshSyncStatus = async () => {
        if (!canRepair) return;
        try { await sync.refreshStatus(); }
        catch (error) { console.error('getSyncStatus error', error); }
    };
    return {
        syncStatus: status?.organizationId === organizationId ? status : null,
        clearSyncStatus: () => setStatus(null),
        refreshSyncStatus,
        repairingCal: sync.repairing,
        resyncingCal: sync.resyncing,
        syncProgress: sync.syncProgress,
        handleRepairCalendar: sync.handleRepair,
        handleForceResyncCalendar: sync.handleForceResync,
    };
}
