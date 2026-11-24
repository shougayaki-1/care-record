import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), sync: vi.fn(), read: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) }) }));
vi.mock('./shifts/googleSyncInternal', () => ({ trySyncSilently: mocks.sync }));
import { confirmMcpShiftUpdate, getMcpShiftUpdateReview } from './mcpShiftUpdateReview';

const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); mocks.sync.mockResolvedValue(undefined); mocks.read.mockResolvedValue({ data: { google_sync_status: 'pending_upsert' }, error: null }); });
describe('getMcpShiftUpdateReview', () => {
  it('requires a session and validates the proposal ID before the RPC', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('private auth detail'));
    expect((await getMcpShiftUpdateReview(id)).ok).toBe(false);
    expect((await getMcpShiftUpdateReview('not-an-id')).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns a safe status from the authorized RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'changed' }, error: null });
    expect(await getMcpShiftUpdateReview(id)).toEqual({ ok: true, data: { status: 'changed' } });
    expect(mocks.rpc).toHaveBeenCalledWith('get_mcp_shift_update_proposal', { p_proposal_id: id });
  });
  it('accepts a fixed review and strips unrelated data', async () => {
    const segment = { id, start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', sort_order: 0,
      service_type_id: null, source_pattern_segment_id: null, staffs: [{ staff_id: id, staff_role_id: null }] };
    mocks.rpc.mockResolvedValue({ error: null, data: { status: 'confirmation_required', proposal_id: id, expires_at: '2026-11-01T02:00:00Z',
      before: { id, title: 'Synthetic', start_at: segment.start_at, end_at: segment.end_at, staffs: [{ staff_id: id }], segments: [segment], report_statuses: ['private status'] },
      proposal: { start_at: segment.start_at, end_at: segment.end_at, segments: [segment] },
      references: { organization: { id, name: 'Org' }, client: { id, name: 'Client' }, staffs: [{ id, name: 'Staff' }], staff_roles: [], service_types: [] } } });
    const result = await getMcpShiftUpdateReview(id);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private status');
  });
  it('does not disclose database errors or malformed responses', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private db detail' } });
    const failure = await getMcpShiftUpdateReview(id);
    expect(failure.ok).toBe(false);
    expect(JSON.stringify(failure)).not.toContain('private db detail');
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'confirmation_required' }, error: null });
    expect((await getMcpShiftUpdateReview(id)).ok).toBe(false);
  });
});

describe('confirmMcpShiftUpdate', () => {
  it('syncs only after a newly committed update and reports the actual status', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'updated', shift_id: id, organization_id: id, google_sync_status: 'pending_upsert', newly_updated: true }, error: null });
    mocks.sync.mockRejectedValue(new Error('synthetic sync failure'));
    mocks.read.mockResolvedValue({ data: { google_sync_status: 'failed' }, error: null });
    expect(await confirmMcpShiftUpdate(id)).toEqual({ ok: true, data: { shiftId: id, googleSyncStatus: 'failed' } });
    expect(mocks.sync).toHaveBeenCalledWith(id, id, 'sync');
  });
  it('does not run sync again on a repeated confirmation', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'updated', shift_id: id, organization_id: id, google_sync_status: 'pending_upsert', newly_updated: false }, error: null });
    expect((await confirmMcpShiftUpdate(id)).ok).toBe(true);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('reports a conflict without exposing database details or syncing', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'proposal_changed' } });
    const result = await confirmMcpShiftUpdate(id);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('proposal_changed');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
