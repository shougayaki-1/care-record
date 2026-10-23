import { describe, expect, it, vi } from 'vitest';
import { runCalendarSyncBatches, syncResultNotice } from './calendarSyncRunner';

const batchResult = { connected: true, processed: 1, succeeded: 1, failed: 0, remaining: 1 };
describe('calendar sync batch execution', () => {
    it('does not request a batch for zero targets', async () => {
        const batch = vi.fn();
        expect(await runCalendarSyncBatches({ total: 0, batch, onProgress: vi.fn(), isActive: () => true })).toEqual({ succeeded: 0, failed: 0 });
        expect(batch).not.toHaveBeenCalled();
    });
    it('aggregates successes, failures and the last error, updating per item', async () => {
        const batch = vi.fn().mockResolvedValueOnce(batchResult).mockResolvedValueOnce({ ...batchResult, failed: 1, errorKind: 'transient' }).mockResolvedValueOnce({ ...batchResult, remaining: 0 });
        const progress = vi.fn();
        expect(await runCalendarSyncBatches({ total: 2, batch, onProgress: progress, isActive: () => true })).toEqual({ succeeded: 3, failed: 1, errorKind: 'transient' });
        expect(progress.mock.calls).toEqual([[1], [2], [2]]);
        expect(syncResultNotice({ succeeded: 2, failed: 1 }, '再試行してください。').severity).toBe('warning');
    });
    it.each([
        { ...batchResult, errorKind: 'auth' },
        { ...batchResult, succeeded: 0, failed: 1 },
        { ...batchResult, processed: 0 },
        { ...batchResult, connected: false, succeeded: 0, processed: 0, errorKind: 'skipped' },
    ])('stops on auth, no success, no progress or disconnection: %j', async result => {
        const batch = vi.fn().mockResolvedValue(result);
        await runCalendarSyncBatches({ total: 3, batch, onProgress: vi.fn(), isActive: () => true });
        expect(batch).toHaveBeenCalledTimes(1);
    });
    it('propagates a mid-run exception and stops', async () => {
        const batch = vi.fn().mockResolvedValueOnce(batchResult).mockRejectedValueOnce(new Error('stop'));
        const progress = vi.fn();
        await expect(runCalendarSyncBatches({ total: 3, batch, onProgress: progress, isActive: () => true })).rejects.toThrow('stop');
        expect(batch).toHaveBeenCalledTimes(2);
        expect(progress.mock.calls).toEqual([[1]]);
    });
    it('does not report or continue a request completed after scope cancellation', async () => {
        let active = true;
        const batch = vi.fn(async () => { active = false; return batchResult; });
        const progress = vi.fn();
        await runCalendarSyncBatches({ total: 3, batch, onProgress: progress, isActive: () => active });
        expect(batch).toHaveBeenCalledTimes(1);
        expect(progress).not.toHaveBeenCalled();
    });
});
