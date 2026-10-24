'use client';

import { useEffect, useRef, useState } from 'react';
import { getSyncStatus, repairGoogleCalendarSync, syncUnsyncedBatch } from '@/app/actions/shift';
import { readActionResult } from '@/utils/actionResult';
import { runCalendarSyncBatches, type RepairResult, type SyncSummary } from '@/utils/calendarSyncRunner';

export type SyncProgress = { total: number; current: number; currentName: string };
type SyncStatus = { total: number; unsynced: number };
export type SyncAdapter = {
    checkConnection: boolean;
    refreshEnabled?: boolean;
    onRefreshError?: (error: unknown) => void;
    refreshAlways: boolean;
    refreshInBackground?: boolean;
    reportAfterRefresh: boolean;
    onDisconnected: () => void;
    onEmpty: () => void;
    onSyncResult: (result: SyncSummary) => void;
    onRepairResult: (result: RepairResult) => void;
    onStatus: (status: SyncStatus) => void;
    onDataRefresh: () => void;
    onError: (error: unknown, repair: boolean) => void;
    confirmRepair: () => Promise<boolean>;
};

/** Screen adapters own notices, confirmation and refresh destinations. */
export function useCalendarSync(organizationId: string | undefined, adapter: SyncAdapter) {
    const scope = useRef<{ organizationId?: string; active: boolean; busy: boolean }>({ active: false, busy: false });
    const [state, setState] = useState<{ organizationId?: string; progress: SyncProgress | null; mode: 'sync' | 'repair' | null }>({ organizationId, progress: null, mode: null });
    // React's render-time adjustment discards the previous organization's UI immediately.
    if (state.organizationId !== organizationId) {
        setState({ organizationId, progress: null, mode: null });
    }
    useEffect(() => {
        const lifetime = { organizationId, active: true, busy: false };
        scope.current = lifetime;
        return () => { lifetime.active = false; };
    }, [organizationId]);

    function capture() {
        const lifetime = scope.current;
        const isActive = () => lifetime.active && lifetime.organizationId === organizationId;
        const progress = (value: SyncProgress | null) => {
            if (isActive()) setState(previous => ({ ...previous, organizationId, progress: value }));
        };
        const refresh = async () => {
            if (!organizationId || !isActive() || adapter.refreshEnabled === false) return;
            try {
                const status = await readActionResult(getSyncStatus(organizationId));
                if (isActive()) adapter.onStatus(status);
            } catch (error) {
                if (!isActive()) return;
                if (adapter.onRefreshError) adapter.onRefreshError(error);
                else throw error;
            }
        };
        return { lifetime, isActive, progress, refresh };
    }

    async function execute(repair: boolean): Promise<boolean> {
        const context = capture();
        if (!organizationId || !context.isActive() || context.lifetime.busy) return false;
        context.lifetime.busy = true;
        let started = false;
        let report: (() => void) | undefined;
        let success = false;
        try {
            // Settings repair deliberately has no preflight; its Action reports connection state.
            if (!repair || adapter.checkConnection) {
                const status = await readActionResult(getSyncStatus(organizationId));
                if (!context.isActive()) return false;
                if (adapter.checkConnection && !status.connected) { adapter.onDisconnected(); return false; }
                if (!repair && status.unsynced === 0) {
                    adapter.onEmpty();
                    if (!adapter.refreshAlways) await context.refresh();
                    return true;
                }
                if (!repair) {
                    started = true;
                    context.progress({ total: status.unsynced, current: 0, currentName: 'Googleカレンダーへ同期中...' });
                    const result = await runCalendarSyncBatches({
                        total: status.unsynced,
                        batch: () => readActionResult(syncUnsyncedBatch(organizationId, 1)),
                        onProgress: current => context.progress({ total: status.unsynced, current, currentName: `${current} / ${status.unsynced} 件 処理済み` }),
                        isActive: context.isActive,
                    });
                    report = () => adapter.onSyncResult(result);
                    success = result.failed === 0 && !result.errorKind;
                }
            }
            if (repair && context.isActive()) {
                started = true;
                context.progress({ total: 1, current: 0, currentName: 'Googleカレンダーの同期状態を修復中...' });
                const result = await readActionResult(repairGoogleCalendarSync(organizationId));
                context.progress({ total: 1, current: 1, currentName: '同期修復が完了しました' });
                report = () => adapter.onRepairResult(result);
                success = result.connected && result.failed === 0 && !result.errorKind;
            }
            if (context.isActive() && (repair || !adapter.reportAfterRefresh)) report?.();
        } finally {
            context.progress(null);
            try {
                if (adapter.refreshAlways || started) {
                    const refreshing = context.refresh();
                    if (adapter.refreshInBackground) {
                        // Settings historically clears its busy state before the status request finishes.
                        void refreshing.catch(error => {
                            if (context.isActive()) adapter.onRefreshError?.(error);
                        });
                    } else await refreshing;
                }
            } finally {
                context.lifetime.busy = false;
            }
        }
        if (context.isActive() && !repair && adapter.reportAfterRefresh) report?.();
        return context.isActive() && success;
    }

    async function handle(repair: boolean) {
        const context = capture();
        if (!organizationId || !context.isActive() || context.lifetime.busy) return;
        if (repair && !(await adapter.confirmRepair())) return;
        if (!context.isActive() || context.lifetime.busy) return;
        setState({ organizationId, progress: null, mode: repair ? 'repair' : 'sync' });
        try {
            await execute(repair);
            if (context.isActive()) adapter.onDataRefresh();
        } catch (error) {
            if (context.isActive()) adapter.onError(error, repair);
        } finally {
            if (context.isActive()) setState({ organizationId, progress: null, mode: null });
        }
    }

    return {
        syncProgress: state.organizationId === organizationId ? state.progress : null,
        repairing: state.organizationId === organizationId && state.mode === 'sync',
        resyncing: state.organizationId === organizationId && state.mode === 'repair',
        setSyncProgress: (value: SyncProgress | null) => capture().progress(value),
        refreshStatus: () => capture().refresh(),
        runUnsyncedSyncLoop: () => execute(false),
        runForceSyncLoop: () => execute(true),
        handleRepair: () => handle(false),
        handleForceResync: () => handle(true),
    };
}
