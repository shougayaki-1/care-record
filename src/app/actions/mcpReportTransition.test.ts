import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
import { confirmMcpReportTransition, getMcpReportRemandReason, getMcpReportTransitionReview } from './mcpReportTransition';
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); });
it('authenticates and validates before reading a proposal', async () => {
  mocks.auth.mockRejectedValueOnce(new Error('secret'));
  expect((await getMcpReportTransitionReview(id)).ok).toBe(false);
  expect((await getMcpReportTransitionReview('invalid')).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('handles conflicts without exposing database details', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'proposal_changed' } });
  const result = await confirmMcpReportTransition(id);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('proposal_changed');
});
it('reads the authorized reason through the session client', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: '修正してください', error: null });
  expect(await getMcpReportRemandReason(id, id)).toEqual({ ok: true, data: '修正してください' });
  expect(mocks.rpc).toHaveBeenCalledWith('get_mcp_report_remand_reason', { p_org: id, p_report: id });
});
