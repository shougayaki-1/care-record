import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), list: vi.fn(), remove: vi.fn(), mark: vi.fn(), limit: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ createSessionClient: vi.fn(async () => ({ rpc: mocks.rpc, from: mocks.from })),
  assertShiftPermission: vi.fn(async () => ({ userId: 'actor' })),
}));
vi.mock('@/utils/googleCalendar', () => ({ getGoogleOAuthClient: () => ({ setCredentials: vi.fn() }) }));
vi.mock('@/utils/googleTokenCrypto', () => ({ decryptGoogleToken: () => 'test-token' }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('googleapis', () => ({ google: { calendar: () => ({}) } }));
vi.mock('./googleSyncInternal', () => ({ deleteGoogleEventIfExists: mocks.remove, listAllActiveGoogleEvents: mocks.list,
  markShiftGoogleSync: mocks.mark, deleteDuplicateGoogleEvents: vi.fn(), processShiftsSequential: vi.fn(),
  syncToGoogleCalendarDirect: vi.fn(), withRetry: vi.fn(),
}));
import { repairGoogleCalendarSync } from './googleSync';
import { SyncError } from '@/utils/googleSync';
beforeEach(() => {
  vi.resetAllMocks();
  const q = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: mocks.limit, single: vi.fn() };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.is.mockReturnValue(q); q.order.mockReturnValue(q);
  q.single.mockResolvedValue({ data: { google_calendar_id: 'calendar', google_refresh_token: 'test' } });
  mocks.limit.mockResolvedValue({ data: [], error: null }); mocks.from.mockReturnValue(q);
  mocks.rpc.mockResolvedValue({ data: [{ id: 'deleted', deleted_at: '2026-10-06', google_event_id: 'remote' }], error: null });
  mocks.list.mockResolvedValue([{ id: 'remote', extendedProperties: { private: { care_record_org_id: 'org', care_record_shift_id: 'deleted' } } }]);
  mocks.remove.mockResolvedValue(true);
  mocks.mark.mockResolvedValue(undefined);
});
describe('repair deleted Google events', () => {
  it('uses authorized deleted identifiers even though normal shift queries hide the row', async () => {
    const result = await repairGoogleCalendarSync('org');
    expect(mocks.rpc).toHaveBeenCalledWith('get_deleted_shift_sync_targets', { p_org_id: 'org', p_limit: 5000 });
    expect(mocks.limit).toHaveBeenCalledWith(4999);
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), 'calendar', 'remote');
    expect(result.deletedRemote).toBe(1); expect(result.succeeded).toBe(1);
    expect(mocks.mark).toHaveBeenCalledWith('deleted', 'synced', { eventId: null });
  });
  it('prioritizes pending deletions within the repair limit', async () => {
    await repairGoogleCalendarSync('org', { limit: 1 });
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('keeps failed deletions pending with a safe diagnostic', async () => {
    mocks.remove.mockRejectedValue(new SyncError('provider details', 'auth'));
    const result = await repairGoogleCalendarSync('org');
    expect(result.failed).toBe(1);
    expect(mocks.mark).toHaveBeenCalledWith('deleted', 'failed', { error: 'Google削除同期に失敗しました（auth）' });
  });
  it('does not delete any remote event if the authorized target query fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } });
    await expect(repairGoogleCalendarSync('org')).rejects.toThrow('処理に失敗しました');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
