import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
import { confirmMcpRecordEdit, getMcpRecordEditReview, listMcpRecordCorrectionProposals } from './mcpRecordEditReview';

const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); });
describe('MCP record edit review', () => {
  it('requires authentication and a valid identifier before the RPC', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('private auth details'));
    expect((await getMcpRecordEditReview(id)).ok).toBe(false);
    expect((await getMcpRecordEditReview('invalid')).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns authorized review status and hides database details', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'changed' }, error: null });
    expect(await getMcpRecordEditReview(id)).toEqual({ ok: true, data: { status: 'changed' } });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private db detail' } });
    const result = await getMcpRecordEditReview(id);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private db detail');
  });
  it('returns the confirmed result and translates stale proposals', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'correction_proposed', report_id: id, base_version: 2, replayed: false }, error: null });
    expect(await confirmMcpRecordEdit(id)).toEqual({ ok: true, data: { status: 'correction_proposed', report_id: id, base_version: 2, replayed: false } });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'proposal_changed' } });
    const result = await confirmMcpRecordEdit(id);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('proposal_changed');
  });
  it('validates pagination and accepts only the listing contract', async () => {
    expect((await listMcpRecordCorrectionProposals(id, -1)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { proposals: [], has_more: false, limit: 20, offset: 0 }, error: null });
    expect((await listMcpRecordCorrectionProposals(id)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('list_mcp_record_correction_proposals', { p_org: id, p_limit: 20, p_offset: 0 });
  });
});
