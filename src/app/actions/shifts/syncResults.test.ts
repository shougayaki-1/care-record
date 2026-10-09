import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), from: vi.fn(), process: vi.fn(), audit: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertShiftPermission: mocks.permission, createSessionClient: async () => ({ from: mocks.from }) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('./googleSyncInternal', () => ({ processShiftsSequential: mocks.process }));
import { forceSyncBatch, syncUnsyncedBatch } from './googleSync';
function query(result: { data?: unknown; error?: unknown; count?: number }) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), or: vi.fn(() => q), gt: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(() => q), single: vi.fn(async () => result),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve) };
  return q;
}
const connected = { data: { google_calendar_id: 'calendar', google_refresh_token: 'synthetic' }, error: null };
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ userId: 'actor' }); mocks.process.mockResolvedValue({ succeeded: 1, failed: 0, stats: {}, errorKind: undefined }); });
describe('sync query failures', () => {
  it.each(['unsynced', 'force'])('does not report no targets when %s target lookup fails', async mode => {
    mocks.from.mockImplementation(table => query(table === 'organizations' ? connected : { data: null, error: { message: 'private SQL 権限 detail' } }));
    const result = mode === 'unsynced' ? await syncUnsyncedBatch('org') : await forceSyncBatch('org', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private SQL');
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(['unsynced', 'force'])('does not report completed sync when %s remaining lookup fails', async mode => {
    mocks.from.mockReturnValueOnce(query(connected)).mockReturnValueOnce(query({ data: [{ id: 'shift' }], error: null }))
      .mockReturnValueOnce(query({ data: null, count: 0, error: { message: 'private remaining detail' } }));
    const result = mode === 'unsynced' ? await syncUnsyncedBatch('org') : await forceSyncBatch('org', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(mocks.process).toHaveBeenCalledOnce();
  });
  it('preserves an empty queue as successful zero work', async () => {
    mocks.from.mockImplementation(table => query(table === 'organizations' ? connected : { data: [], error: null }));
    await expect(syncUnsyncedBatch('org')).resolves.toMatchObject({ ok: true, data: { processed: 0, remaining: 0, connected: true } });
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
