import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remoteDelete: vi.fn(), list: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ createSessionClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock('@/utils/googleCalendar', () => ({ getGoogleOAuthClient: () => ({ setCredentials: vi.fn() }) }));
vi.mock('@/utils/googleTokenCrypto', () => ({ decryptGoogleToken: () => 'test-token' }));
vi.mock('@/utils/googleRetry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ events: { delete: mocks.remoteDelete, list: mocks.list } }) } }));
import { processShiftsSequential } from './googleSyncInternal';
import { SyncError } from '@/utils/googleSync';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockImplementation(async name => ({ data: name === 'get_google_sync_target' ? {
    organization: { google_calendar_id: 'calendar', google_refresh_token: 'test' },
    shift: { deleted_at: '2026-10-06', google_event_id: 'remote' },
  } : null, error: null }));
  mocks.list.mockResolvedValue({ data: { items: [] } });
});
describe('Google deletion outcomes', () => {
  it('allows an unconnected organization and retains pending deletion', async () => {
    mocks.rpc.mockResolvedValue({ data: { organization: { google_calendar_id: null } }, error: null });
    const result = await processShiftsSequential('org', [{ id: 'one' }], 'delete', 0);
    expect(result.failed).toBe(0); expect(result.succeeded).toBe(1);
    expect(mocks.remoteDelete).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith('mark_shift_google_sync', expect.anything());
  });
  it.each(['auth', 'permanent'] as const)('records %s failures for every deleted shift, including after an auth failure', async kind => {
    mocks.remoteDelete.mockRejectedValue(new SyncError('provider details', kind));
    const result = await processShiftsSequential('org', [{ id: 'one' }, { id: 'two' }], 'delete', 0);
    expect(result.failedIds).toEqual(['one', 'two']); expect(result.errorKind).toBe(kind);
    expect(mocks.rpc).toHaveBeenCalledWith('mark_shift_google_sync', expect.objectContaining({ p_status: 'failed', p_error: `Google削除同期に失敗しました（${kind}）` }));
  });
  it('marks a completed remote deletion synced and clears the remote event link', async () => {
    const result = await processShiftsSequential('org', [{ id: 'one' }], 'delete', 0);
    expect(result.failed).toBe(0);
    expect(mocks.rpc).toHaveBeenCalledWith('mark_shift_google_sync', expect.objectContaining({ p_status: 'synced', p_event_id: null, p_set_event_id: true }));
  });
});
