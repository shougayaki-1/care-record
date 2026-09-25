'use client';

import { googleSyncErrorMessage } from '@/utils/googleSync';

import { useState, useCallback } from 'react';
import { getSyncStatus, syncUnsyncedBatch, repairGoogleCalendarSync } from '@/app/actions/shift';

type UseSyncProgressParams = {
    currentOrg: { id: string } | null;
    showToast: (msg: string, severity?: 'success' | 'info' | 'warning' | 'error') => void;
    confirm: (options: { message: string; title?: string; confirmText?: string; confirmColor?: 'primary' | 'error' | 'warning' }) => Promise<boolean>;
    setUnsyncedCount: (count: number) => void;
    onDataRefresh: () => void;
};

export const useSyncProgress = ({
    currentOrg,
    showToast,
    confirm,
    setUnsyncedCount,
    onDataRefresh,
}: UseSyncProgressParams) => {
    const [syncProgress, setSyncProgress] = useState<{ total: number; current: number; currentName: string } | null>(null);
    const [repairingFromBanner, setRepairingFromBanner] = useState(false);
    const [resyncingCal, setResyncingCal] = useState(false);

    const reportSyncResult = useCallback((done: number, failed: number, errorKind?: string) => {
        const message = googleSyncErrorMessage(errorKind);
        if (message) {
            showToast(message, 'warning');
        } else if (failed > 0) {
            showToast(`同期が一部失敗しました（成功 ${done} 件 / 失敗 ${failed} 件）。通信状況を確認し、しばらくしてから再同期してください。`, 'warning');
        } else {
            showToast(`Googleカレンダーへの同期が完了しました（${done} 件）。`, 'success');
        }
    }, [showToast]);

    const reportRepairResult = useCallback((res: Awaited<ReturnType<typeof repairGoogleCalendarSync>>) => {
        if (!res.connected) {
            showToast('Googleカレンダーが連携されていません。設定画面から接続してください。', 'warning');
        } else if (res.errorKind) {
            showToast(googleSyncErrorMessage(res.errorKind)!, 'warning');
        } else if (res.failed > 0) {
            showToast(`同期修復が一部失敗しました（成功 ${res.succeeded} 件 / 失敗 ${res.failed} 件）。`, 'warning');
        } else {
            showToast(`同期修復が完了しました（作成 ${res.created} / 更新 ${res.updated} / 再リンク ${res.linked} / 重複削除 ${res.deduped} / Google削除 ${res.deletedRemote}）。`, 'success');
        }
    }, [showToast]);

    const refreshUnsyncedCount = useCallback(async () => {
        if (!currentOrg) return;
        const status = await getSyncStatus(currentOrg.id);
        setUnsyncedCount(status.unsynced);
    }, [currentOrg, setUnsyncedCount]);

    const runUnsyncedSyncLoop = useCallback(async (): Promise<boolean> => {
        if (!currentOrg) return false;
        const status = await getSyncStatus(currentOrg.id);
        if (!status.connected) {
            showToast('Googleカレンダーが連携されていません。設定画面から接続してください。', 'warning');
            return false;
        }
        const total = status.unsynced;
        if (total === 0) { await refreshUnsyncedCount(); return true; }

        setSyncProgress({ total, current: 0, currentName: 'Googleカレンダーへ同期中...' });
        let done = 0, failed = 0, processed = 0;
        let errorKind: string | undefined;
        try {
            for (;;) {
                // 進捗モーダルは1件の完了ごとに更新する。まとめて20件を処理すると
                // 表示が一度に進み、処理が止まったように見えてしまう。
                const res = await syncUnsyncedBatch(currentOrg.id, 1);
                done += res.succeeded;
                failed += res.failed;
                processed += res.processed;
                if (res.errorKind) errorKind = res.errorKind;
                const current = Math.min(total, processed);
                setSyncProgress({ total, current, currentName: `${current} / ${total} 件 処理済み` });
                if (errorKind === 'auth' || res.remaining <= 0 || res.succeeded === 0) break;
            }
        } finally {
            setSyncProgress(null);
            await refreshUnsyncedCount();
        }
        reportSyncResult(done, failed, errorKind);
        return failed === 0 && !errorKind;
    }, [currentOrg, showToast, refreshUnsyncedCount, reportSyncResult]);

    const runForceSyncLoop = useCallback(async (): Promise<boolean> => {
        if (!currentOrg) return false;
        const status = await getSyncStatus(currentOrg.id);
        if (!status.connected) {
            showToast('Googleカレンダーが連携されていません。設定画面から接続してください。', 'warning');
            return false;
        }
        setSyncProgress({ total: 1, current: 0, currentName: 'Googleカレンダーの同期状態を修復中...' });
        try {
            const res = await repairGoogleCalendarSync(currentOrg.id);
            setSyncProgress({ total: 1, current: 1, currentName: '同期修復が完了しました' });
            reportRepairResult(res);
            return res.connected && res.failed === 0 && !res.errorKind;
        } finally {
            setSyncProgress(null);
            await refreshUnsyncedCount();
        }
    }, [currentOrg, showToast, refreshUnsyncedCount, reportRepairResult]);

    const handleRepairFromBanner = useCallback(async () => {
        if (!currentOrg) return;
        setRepairingFromBanner(true);
        try {
            await runUnsyncedSyncLoop();
            onDataRefresh();
        } finally {
            setRepairingFromBanner(false);
        }
    }, [currentOrg, runUnsyncedSyncLoop, onDataRefresh]);

    const handleForceResyncCalendar = useCallback(async () => {
        if (!currentOrg) return;
        if (!(await confirm({ message: 'Googleカレンダーの同期状態を修復します。既存予定の再リンク、重複削除、削除済みシフトのGoogle側削除を行います。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。' }))) return;

        setResyncingCal(true);
        try {
            await runForceSyncLoop();
            onDataRefresh();
        } finally {
            setResyncingCal(false);
        }
    }, [currentOrg, confirm, runForceSyncLoop, onDataRefresh]);

    return {
        syncProgress,
        setSyncProgress,
        repairingFromBanner,
        resyncingCal,
        runUnsyncedSyncLoop,
        runForceSyncLoop,
        refreshUnsyncedCount,
        handleRepairFromBanner,
        handleForceResyncCalendar,
    };
};
