'use client';

import { useState, useCallback } from 'react';
import { getSyncStatus, syncUnsyncedBatch, forceSyncBatch } from '@/app/actions/shift';

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
        if (errorKind === 'auth') {
            showToast('Googleカレンダーの認証が切れています。設定画面から連携を再接続してください。', 'error');
        } else if (failed > 0) {
            showToast(`同期が一部失敗しました（成功 ${done} 件 / 失敗 ${failed} 件）。通信状況を確認し、しばらくしてから再同期してください。`, 'warning');
        } else {
            showToast(`Googleカレンダーへの同期が完了しました（${done} 件）。`, 'success');
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
        let done = 0, failed = 0;
        let errorKind: string | undefined;
        try {
            for (;;) {
                const res = await syncUnsyncedBatch(currentOrg.id, 20);
                done += res.succeeded;
                failed += res.failed;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, done), currentName: `${Math.min(total, done)} / ${total} 件 同期済み` });
                if (errorKind === 'auth' || res.remaining <= 0 || res.succeeded === 0) break;
            }
        } finally {
            setSyncProgress(null);
            await refreshUnsyncedCount();
        }
        reportSyncResult(done, failed, errorKind);
        return failed === 0 && errorKind !== 'auth';
    }, [currentOrg, showToast, refreshUnsyncedCount, reportSyncResult]);

    const runForceSyncLoop = useCallback(async (): Promise<boolean> => {
        if (!currentOrg) return false;
        const status = await getSyncStatus(currentOrg.id);
        if (!status.connected) {
            showToast('Googleカレンダーが連携されていません。設定画面から接続してください。', 'warning');
            return false;
        }
        const total = status.total;
        if (total === 0) return true;

        setSyncProgress({ total, current: 0, currentName: '全件再同期の準備中...' });
        let cursor: string | null = null;
        let done = 0, failed = 0;
        let errorKind: string | undefined;
        try {
            for (;;) {
                const res = await forceSyncBatch(currentOrg.id, cursor, 20);
                done += res.processed;
                failed += res.failed;
                cursor = res.nextCursor;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, done), currentName: `${Math.min(total, done)} / ${total} 件 再同期済み` });
                if (errorKind === 'auth' || res.remaining <= 0 || res.processed === 0) break;
            }
        } finally {
            setSyncProgress(null);
            await refreshUnsyncedCount();
        }
        reportSyncResult(done, failed, errorKind);
        return failed === 0 && errorKind !== 'auth';
    }, [currentOrg, showToast, refreshUnsyncedCount, reportSyncResult]);

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
        if (!(await confirm({ message: 'カレンダーに登録されているすべての予定をGoogleカレンダーへ強制的に再同期します。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。' }))) return;

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
