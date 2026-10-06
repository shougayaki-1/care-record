import { readActionResult } from '@/utils/actionResult';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncError } from '@/utils/googleSync';
const mocks = vi.hoisted(() => ({ sync: vi.fn(), mark: vi.fn(), audit: vi.fn(), permission: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertShiftPermission: mocks.permission }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('./googleSyncInternal', () => ({ syncToGoogleCalendarDirect: mocks.sync, markShiftGoogleSync: mocks.mark }));
import { syncSingleShift } from './googleSync';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ userId: 'actor' });
  mocks.mark.mockResolvedValue(undefined);
});
describe('single Google sync failure recording', () => {
  it('records a safe failed status through the notification trigger boundary', async () => {
    mocks.sync.mockRejectedValue(new SyncError('PHI token fixture', 'auth'));
    await expect(readActionResult(syncSingleShift('org', 'shift'))).rejects.toThrow();
    expect(mocks.mark).toHaveBeenCalledWith('shift', 'failed', { error: expect.any(String) });
    expect(JSON.stringify(mocks.mark.mock.calls)).not.toContain('PHI');
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('does not mark skipped or successful sync as failure', async () => {
    mocks.sync.mockRejectedValueOnce(new SyncError('not connected', 'skipped'));
    await readActionResult(syncSingleShift('org', 'shift')).catch(() => undefined);
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(await readActionResult(syncSingleShift('org', 'shift'))).toEqual({ success: true });
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it('does not mistake an audit failure after sync success for a sync failure', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(readActionResult(syncSingleShift('org', 'shift'))).rejects.toThrow();
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it('preserves the original external failure even when marking the status fails', async () => {
    mocks.sync.mockRejectedValue(new SyncError('original provider failure', 'auth'));
    mocks.mark.mockRejectedValue(new Error('notification DB failure'));
    const result = await syncSingleShift('org', 'shift');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('notification DB failure');
  });
  it('rejects unauthorized callers before sync and notification status work', async () => {
    mocks.permission.mockRejectedValue(new Error('permission denied'));
    await expect(readActionResult(syncSingleShift('org', 'shift'))).rejects.toThrow();
    expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  });
});
