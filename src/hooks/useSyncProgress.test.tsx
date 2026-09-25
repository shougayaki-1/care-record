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
    mocks.status.mockResolvedValue({ connected: true, unsynced: 1 });
});
afterEach(cleanup);

describe('repair error reporting', () => {
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
