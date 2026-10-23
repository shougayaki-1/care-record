// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ status: vi.fn(), batch: vi.fn(), repair: vi.fn() }));
vi.mock('@/app/actions/shift', () => ({ getSyncStatus: mocks.status, syncUnsyncedBatch: mocks.batch, repairGoogleCalendarSync: mocks.repair }));
import { useSettingsCalendarSync } from './useSettingsCalendarSync';
import { useSyncProgress } from './useSyncProgress';

const ok = <T,>(data: T) => ({ ok: true, data });
const status = { connected: true, total: 3, unsynced: 2 };
const batch = { connected: true, processed: 1, succeeded: 1, failed: 0, remaining: 1 };
const repaired = { connected: true, succeeded: 2, failed: 0, created: 1, updated: 1, linked: 0, deduped: 0, deletedRemote: 0 };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
beforeEach(() => {
    vi.resetAllMocks();
    mocks.status.mockResolvedValue(ok(status));
    mocks.batch.mockResolvedValue(ok({ ...batch, remaining: 0 }));
    mocks.repair.mockResolvedValue(ok(repaired));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const screen of ['settings', 'shifts'] as const) {
    describe(`${screen} sync adapter`, () => {
        function setup() {
            const toast = vi.fn(), refresh = vi.fn(), count = vi.fn();
            const confirm = vi.fn().mockResolvedValue(true);
            const hook = renderHook(({ id }: { id: string }) => {
                // Both hooks are always called, preserving Hook ordering; only the selected adapter runs.
                const settings = useSettingsCalendarSync({ organizationId: id, canRepair: true, showToast: toast, confirm });
                const shifts = useSyncProgress({ currentOrg: { id }, showToast: toast, confirm, setUnsyncedCount: count, onDataRefresh: refresh });
                return screen === 'settings' ? {
                    sync: settings.handleRepairCalendar, repair: settings.handleForceResyncCalendar,
                    progress: settings.syncProgress, busy: settings.repairingCal, resyncing: settings.resyncingCal,
                    status: settings.syncStatus,
                } : {
                    sync: shifts.handleRepairFromBanner, repair: shifts.handleForceResyncCalendar,
                    progress: shifts.syncProgress, busy: shifts.repairingFromBanner, resyncing: shifts.resyncingCal,
                    status: null,
                };
            }, { initialProps: { id: 'org-a' } });
            return { ...hook, toast, refresh, count, confirm };
        }
        it('updates progress one item at a time, reports success and refreshes its screen', async () => {
            const first = deferred<ReturnType<typeof ok<typeof batch>>>();
            const second = deferred<ReturnType<typeof ok<typeof batch>>>();
            mocks.batch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
            const h = setup();
            let running!: Promise<void>;
            await act(async () => { running = h.result.current.sync(); });
            expect(h.result.current.busy).toBe(true);
            expect(h.result.current.progress).toMatchObject({ total: 2, current: 0 });
            await act(async () => { first.resolve(ok(batch)); });
            expect(h.result.current.progress).toMatchObject({ total: 2, current: 1 });
            await act(async () => { second.resolve(ok({ ...batch, remaining: 0 })); await running; });
            expect(mocks.batch.mock.calls).toEqual([['org-a', 1], ['org-a', 1]]);
            expect(h.result.current.progress).toBeNull();
            expect(h.result.current.busy).toBe(false);
            expect(h.toast).toHaveBeenCalledWith('Googleカレンダーへの同期が完了しました（2 件）。', 'success');
            if (screen === 'settings') expect(h.result.current.status).toMatchObject(status);
            else { expect(h.count).toHaveBeenCalledWith(2); expect(h.refresh).toHaveBeenCalledTimes(1); }
        });
        it('preserves the different disconnected preflight behavior', async () => {
            mocks.status.mockResolvedValue(ok({ ...status, connected: false, unsynced: 0 }));
            const h = setup();
            await act(async () => { await h.result.current.sync(); });
            expect(mocks.batch).not.toHaveBeenCalled();
            expect(h.toast).toHaveBeenCalledWith(expect.any(String), screen === 'settings' ? 'info' : 'warning');
            expect(mocks.status).toHaveBeenCalledTimes(screen === 'settings' ? 2 : 1);
        });
        it('preserves zero-item notices and completion refresh', async () => {
            mocks.status.mockResolvedValue(ok({ ...status, unsynced: 0 }));
            const h = setup();
            await act(async () => { await h.result.current.sync(); });
            expect(mocks.batch).not.toHaveBeenCalled();
            expect(mocks.status).toHaveBeenCalledTimes(2);
            if (screen === 'settings') expect(h.toast).toHaveBeenCalledWith('未同期の予定はありません。', 'info');
            else { expect(h.toast).not.toHaveBeenCalled(); expect(h.refresh).toHaveBeenCalled(); }
        });
        it.each([undefined, 'auth', 'transient', 'forbidden', 'misconfigured', 'rate_limit', 'permanent', 'skipped'])('reports partial failure / %s as warning and refreshes', async errorKind => {
            mocks.batch.mockResolvedValue(ok({ ...batch, succeeded: 0, failed: 1, errorKind }));
            const h = setup();
            await act(async () => { await h.result.current.sync(); });
            expect(mocks.batch).toHaveBeenCalledTimes(1);
            expect(h.toast).toHaveBeenCalledWith(expect.any(String), 'warning');
            expect(h.toast).not.toHaveBeenCalledWith(expect.any(String), 'success');
            expect(mocks.status).toHaveBeenCalledTimes(2);
        });
        it('cleans up and refreshes after a mid-run exception', async () => {
            mocks.batch.mockResolvedValueOnce(ok(batch)).mockRejectedValueOnce(new Error('interrupted'));
            const h = setup();
            await act(async () => { await h.result.current.sync(); });
            expect(h.toast).toHaveBeenCalledWith(expect.any(String), 'error');
            expect(h.result.current.progress).toBeNull();
            expect(h.result.current.busy).toBe(false);
            expect(mocks.status).toHaveBeenCalledTimes(2);
            expect(h.refresh).not.toHaveBeenCalled();
        });
        it('confirms repair, reports its result and refreshes', async () => {
            const h = setup();
            await act(async () => { await h.result.current.repair(); });
            expect(h.confirm).toHaveBeenCalledTimes(1);
            expect(mocks.repair).toHaveBeenCalledWith('org-a');
            expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('作成 1 / 更新 1'), 'success');
            expect(mocks.status).toHaveBeenCalledTimes(screen === 'settings' ? 1 : 2);
            expect(h.result.current.resyncing).toBe(false);
        });
        it('does not start a cancelled repair', async () => {
            const h = setup(); h.confirm.mockResolvedValue(false);
            await act(async () => { await h.result.current.repair(); });
            expect(mocks.repair).not.toHaveBeenCalled();
            expect(mocks.status).not.toHaveBeenCalled();
        });
        it.each(['auth', 'transient', 'forbidden', 'misconfigured'])('reports repair %s without success', async errorKind => {
            mocks.repair.mockResolvedValue(ok({ ...repaired, errorKind }));
            const h = setup();
            await act(async () => { await h.result.current.repair(); });
            expect(h.toast).toHaveBeenCalledWith(expect.any(String), 'warning');
            expect(h.toast).not.toHaveBeenCalledWith(expect.any(String), 'success');
        });
        it.each(['switch', 'unmount'])('stops stale batches on %s without notices or refresh', async change => {
            const pending = deferred<ReturnType<typeof ok<typeof batch>>>();
            mocks.batch.mockReturnValueOnce(pending.promise);
            const h = setup(); let running!: Promise<void>;
            await act(async () => { running = h.result.current.sync(); });
            if (change === 'switch') h.rerender({ id: 'org-b' }); else h.unmount();
            await act(async () => { pending.resolve(ok(batch)); await running; });
            expect(mocks.batch.mock.calls).toEqual([['org-a', 1]]);
            expect(mocks.status.mock.calls).toEqual([['org-a']]);
            expect(h.toast).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled(); expect(h.count).not.toHaveBeenCalled();
            if (change === 'switch') { expect(h.result.current.progress).toBeNull(); expect(h.result.current.busy).toBe(false); }
        });
        it('ignores an old status refresh after an organization switch', async () => {
            const pending = deferred<ReturnType<typeof ok<typeof status>>>();
            mocks.status.mockResolvedValueOnce(ok(status)).mockReturnValueOnce(pending.promise);
            const h = setup(); let running!: Promise<void>;
            await act(async () => { running = h.result.current.sync(); });
            h.rerender({ id: 'org-b' });
            const previousToastCalls = h.toast.mock.calls.length;
            await act(async () => { pending.resolve(ok(status)); await running; });
            expect(h.count).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
            expect(h.toast).toHaveBeenCalledTimes(previousToastCalls);
            expect(h.result.current.status).toBeNull();
        });
        it('does not let a stale repair clear a new organization operation', async () => {
            const oldRepair = deferred<ReturnType<typeof ok<typeof repaired>>>();
            const newBatch = deferred<ReturnType<typeof ok<typeof batch>>>();
            mocks.repair.mockReturnValueOnce(oldRepair.promise);
            const h = setup(); let oldRunning!: Promise<void>, newRunning!: Promise<void>;
            await act(async () => { oldRunning = h.result.current.repair(); });
            h.rerender({ id: 'org-b' });
            mocks.batch.mockReturnValueOnce(newBatch.promise);
            await act(async () => { newRunning = h.result.current.sync(); });
            await act(async () => { oldRepair.resolve(ok(repaired)); await oldRunning; });
            expect(h.result.current.busy).toBe(true);
            expect(h.result.current.progress).toMatchObject({ current: 0 });
            expect(h.toast).not.toHaveBeenCalled();
            await act(async () => { newBatch.resolve(ok({ ...batch, remaining: 0 })); await newRunning; });
            expect(mocks.batch).toHaveBeenCalledWith('org-b', 1);
            expect(h.result.current.busy).toBe(false);
        });
        it('ignores a duplicate start while a batch is pending', async () => {
            const pending = deferred<ReturnType<typeof ok<typeof batch>>>();
            mocks.batch.mockReturnValueOnce(pending.promise);
            const h = setup(); let running!: Promise<void>;
            await act(async () => { running = h.result.current.sync(); });
            await act(async () => { await h.result.current.sync(); });
            expect(mocks.batch).toHaveBeenCalledTimes(1);
            await act(async () => { pending.resolve(ok({ ...batch, remaining: 0 })); await running; });
        });
        it('rejects a callback retained from a previous organization', async () => {
            const h = setup(); const oldSync = h.result.current.sync;
            h.rerender({ id: 'org-b' });
            await act(async () => { await oldSync(); });
            expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
        });
        it('keeps disconnected repair guidance and its screen-specific preflight', async () => {
            mocks.status.mockResolvedValue(ok({ ...status, connected: false }));
            mocks.repair.mockResolvedValue(ok({ ...repaired, connected: false }));
            const h = setup();
            await act(async () => { await h.result.current.repair(); });
            expect(mocks.repair).toHaveBeenCalledTimes(screen === 'settings' ? 1 : 0);
            expect(h.toast).toHaveBeenCalledWith(expect.stringContaining(screen === 'settings' ? '「連携する」' : '設定画面'), 'warning');
        });
        it('does not resume confirmation after switching organizations', async () => {
            const pending = deferred<boolean>(); const h = setup(); h.confirm.mockReturnValue(pending.promise);
            let running!: Promise<void>;
            await act(async () => { running = h.result.current.repair(); });
            h.rerender({ id: 'org-b' });
            await act(async () => { pending.resolve(true); await running; });
            expect(mocks.repair).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
        });
    });
}
