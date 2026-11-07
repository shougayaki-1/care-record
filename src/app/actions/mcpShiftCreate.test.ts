import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), sync: vi.fn(), read: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) }) }));
vi.mock('./shifts/googleSyncInternal', () => ({ trySyncSilently: mocks.sync }));
import { confirmMcpShiftCreate } from './mcpShiftCreate';
const id = '17900000-0000-4000-8000-000000000001';
const org = '17900000-0000-4000-8000-000000000002';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); mocks.rpc.mockResolvedValue({ data: { status: 'created', shift_id: id, organization_id: org, google_sync_status: 'pending_upsert', newly_created: true }, error: null }); mocks.sync.mockResolvedValue(undefined); mocks.read.mockResolvedValue({ data: { google_sync_status: 'synced' }, error: null }); });
describe('confirmed MCP shift creation', () => {
  it('shows the sync state after a successful creation', async () => {
    expect(await confirmMcpShiftCreate(id)).toEqual({ ok: true, data: { shiftId: id, googleSyncStatus: 'synced' } });
    expect(mocks.sync).toHaveBeenCalledWith(org, id, 'sync');
  });
  it('keeps the committed creation visible when Google sync fails', async () => {
    mocks.sync.mockRejectedValue(new Error('private provider details'));
    mocks.read.mockResolvedValue({ data: null, error: { message: 'private DB detail' } });
    expect(await confirmMcpShiftCreate(id)).toEqual({ ok: true, data: { shiftId: id, googleSyncStatus: null } });
  });
  it('does not sync or create again when a retry returns the existing result', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'created', shift_id: id, organization_id: org, google_sync_status: 'pending_upsert', newly_created: false }, error: null });
    expect((await confirmMcpShiftCreate(id)).ok).toBe(true);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('reports a conflict without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'shift_conflict' } });
    const result = await confirmMcpShiftCreate(id);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('shift_conflict');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
