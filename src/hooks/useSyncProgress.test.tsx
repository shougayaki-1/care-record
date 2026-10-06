// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn(), repair: vi.fn() }));
vi.mock('@/app/actions/shift', () => ({
    getSyncStatus: mocks.status, repairGoogleCalendarSync: mocks.repair, syncUnsyncedBatch: vi.fn(),
}));
import { useSyncProgress } from './useSyncProgress';

beforeEach(() => {
    vi.resetAllMocks();
    mocks.status.mockResolvedValue({ ok: true, data: { connected: true, unsynced: 1 } });
});
afterEach(cleanup);

describe('repair error reporting', () => {
    it.each(['FORBIDDEN', 'SESSION_EXPIRED', 'UNEXPECTED_ERROR'])(
        'shows a safe %s result and does not start repair or refresh data', async code => {
            mocks.status.mockResolvedValue({ ok: false, error: { code, message: '安全な失敗文言' } });
            const showToast = vi.fn();
            const refresh = vi.fn();
            const { result } = renderHook(() => useSyncProgress({
                currentOrg: { id: 'test-org' }, showToast, confirm: vi.fn().mockResolvedValue(true),
                setUnsyncedCount: vi.fn(), onDataRefresh: refresh,
            }));
            await act(async () => { await result.current.handleForceResyncCalendar(); });
            expect(showToast).toHaveBeenCalledWith('安全な失敗文言', 'error');
            expect(mocks.repair).not.toHaveBeenCalled();
            expect(refresh).not.toHaveBeenCalled();
            expect(result.current.resyncingCal).toBe(false);
            expect(result.current.syncProgress).toBeNull();
        },
    );
    it.each(['transient', 'forbidden', 'misconfigured', 'auth'])(
        'does not report success when initial remote scan fails with %s before processing any shifts',
        async (errorKind) => {
            mocks.repair.mockResolvedValue({ connected: true, failed: 0, succeeded: 0, errorKind });
            const showToast = vi.fn();
            const { result } = renderHook(() => useSyncProgress({
                currentOrg: { id: 'test-org' }, showToast, confirm: vi.fn(),
                setUnsyncedCount: vi.fn(), onDataRefresh: vi.fn(),
            }));
            let success: boolean | undefined;
            await act(async () => { success = await result.current.runForceSyncLoop(); });
            expect(success).toBe(false);
            expect(showToast).toHaveBeenCalledWith(expect.any(String), 'warning');
            expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'success');
            expect(result.current.syncProgress).toBeNull();
        },
    );
});
