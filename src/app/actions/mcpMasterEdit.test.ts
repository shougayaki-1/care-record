import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
import { confirmMcpMasterEdit, getMcpMasterEditReview } from './mcpMasterEdit';
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); });
it('validates proposal IDs before review or confirmation', async () => {
  expect((await getMcpMasterEditReview('bad')).ok).toBe(false);
  expect((await confirmMcpMasterEdit('bad')).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('rejects incomplete fixed identity data', async () => {
  mocks.rpc.mockResolvedValue({ error: null, data: { status: 'confirmation_required', kind: 'client' } });
  expect((await getMcpMasterEditReview(id)).ok).toBe(false);
});
it('returns a safe conflict and never exposes database details', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: '22023', message: 'proposal_changed' }, data: null });
  const result = await confirmMcpMasterEdit(id);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('proposal_changed');
});
