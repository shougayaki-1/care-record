import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
import { confirmMcpReportTransitionBatch, getMcpReportTransitionBatchReview } from './mcpReportTransitionBatch';
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); });
it('rejects invalid identifiers before calling the database', async () => {
  expect((await getMcpReportTransitionBatchReview('invalid')).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('rejects a result whose count does not match the items', async () => {
  mocks.rpc.mockResolvedValue({ data: { status: 'completed', count: 2, items: [{ status: 'approved', report_id: id, replayed: false }], replayed: false }, error: null });
  expect((await confirmMcpReportTransitionBatch(id)).ok).toBe(false);
});
it('explains a conflict without exposing raw database details', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'proposal_changed' } });
  const result = await confirmMcpReportTransitionBatch(id);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('proposal_changed');
});
