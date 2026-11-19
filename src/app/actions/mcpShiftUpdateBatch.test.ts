import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), sync: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('./shifts/googleSyncInternal', () => ({ trySyncSilently: mocks.sync }));
import { confirmMcpShiftUpdateBatch, getMcpShiftUpdateBatch } from './mcpShiftUpdateBatch';
const batchId = '10000000-0000-4000-8000-000000000001';
const first = '10000000-0000-4000-8000-000000000002';
const second = '10000000-0000-4000-8000-000000000003';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: batchId }); });
it('validates selection and never sends duplicate IDs', async () => {
  expect((await confirmMcpShiftUpdateBatch(batchId, [first, first])).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('returns individual failures and syncs only newly updated shifts', async () => {
  mocks.rpc.mockResolvedValue({ error: null, data: { items: [
    { proposal_id: first, status: 'updated', result: { shift_id: first, organization_id: batchId, newly_updated: true } },
    { proposal_id: second, status: 'shift_conflict' },
  ] } });
  mocks.sync.mockRejectedValue(new Error('synthetic sync failure'));
  expect(await confirmMcpShiftUpdateBatch(batchId, [first, second])).toEqual({ ok: true, data: [
    { proposalId: first, status: 'updated' }, { proposalId: second, status: 'shift_conflict' },
  ] });
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(mocks.sync).toHaveBeenCalledWith(batchId, first, 'sync');
});
it('fails closed when a review response lacks fixed identity data', async () => {
  mocks.rpc.mockResolvedValue({ error: null, data: { batch_id: batchId, expires_at: '2026-11-01T05:00:00Z', items: [
    { position: 1, proposal_id: first, has_overlap: false, has_unassigned: false, review: { status: 'confirmation_required' } },
  ] } });
  expect((await getMcpShiftUpdateBatch(batchId)).ok).toBe(false);
});
