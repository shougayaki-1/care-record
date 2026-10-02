import { describe, expect, it, vi } from 'vitest';
import { commitRecordChange, subscribeRecordFeed } from './recordFeedUpdates';
describe('committed record changes', () => {
  it('refreshes the same organization only after persistence succeeds', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined); const other = vi.fn();
    const stop = subscribeRecordFeed('one', refresh); const stopOther = subscribeRecordFeed('two', other);
    try {
      const result = await commitRecordChange('one', async () => { expect(refresh).not.toHaveBeenCalled(); return { reportId: 'saved' }; });
      expect(result.reportId).toBe('saved'); expect(refresh).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
    } finally { stop(); stopOther(); }
  });
  it('refreshes partial batches once and skips batches with no committed rows', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined); const stop = subscribeRecordFeed('one', refresh);
    const anyCommitted = (batch: PromiseSettledResult<string>[]) => batch.some((result) => result.status === 'fulfilled');
    try {
      const partial = await commitRecordChange('one', () => Promise.allSettled([Promise.resolve('saved'), Promise.reject(new Error('failed row'))]), anyCommitted);
      expect(partial.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(refresh).toHaveBeenCalledOnce();
      await commitRecordChange('one', () => Promise.allSettled([Promise.reject(new Error('failed row'))]), anyCommitted);
      expect(refresh).toHaveBeenCalledOnce();
    } finally { stop(); }
  });
  it('does not invalidate failed writes or retry a committed write on a read error', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('read failed')); const stop = subscribeRecordFeed('one', refresh);
    try {
      await expect(commitRecordChange('one', async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
      expect(refresh).not.toHaveBeenCalled();
      const write = vi.fn().mockResolvedValue('committed');
      await expect(commitRecordChange('one', write)).resolves.toBe('committed');
      expect(write).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
    } finally { stop(); }
  });
});
