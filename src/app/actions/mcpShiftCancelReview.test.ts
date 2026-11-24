import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), sync: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('./shifts/googleSyncInternal', () => ({ trySyncSilently: mocks.sync }));
import { confirmMcpShiftCancel, getMcpShiftCancelReview } from './mcpShiftCancelReview';
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id }); mocks.sync.mockResolvedValue(undefined); });
it('requires an authenticated user and a valid proposal identifier', async () => {
  mocks.auth.mockRejectedValueOnce(new Error('private auth detail'));
  expect((await getMcpShiftCancelReview(id)).ok).toBe(false);
  expect((await getMcpShiftCancelReview('invalid')).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([['cancel', 'sync'], ['soft_delete', 'delete']] as const)('syncs a newly committed %s operation', async (operation, action) => {
  mocks.rpc.mockResolvedValueOnce({ data: { status: 'updated', operation, shift_id: id, organization_id: id, newly_updated: true }, error: null })
    .mockResolvedValueOnce({ data: { status: 'updated', operation, shift_id: id, google_sync_status: 'failed' }, error: null });
  expect(await confirmMcpShiftCancel(id)).toEqual({ ok: true, data: { operation, googleSyncStatus: 'failed' } });
  expect(mocks.sync).toHaveBeenCalledWith(id, id, action);
});
it('does not repeat sync after an idempotent confirmation', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { status: 'updated', operation: 'soft_delete', shift_id: id, organization_id: id, newly_updated: false }, error: null })
    .mockResolvedValueOnce({ data: { status: 'updated', operation: 'soft_delete', shift_id: id, google_sync_status: 'pending_delete' }, error: null });
  expect((await confirmMcpShiftCancel(id)).ok).toBe(true);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('does not sync after a stale proposal or expose its internal error', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'proposal_changed' } });
  const result = await confirmMcpShiftCancel(id);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('proposal_changed');
  expect(mocks.sync).not.toHaveBeenCalled();
});
