import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getAuthedUser: vi.fn(), assertOrgRole: vi.fn(), assertOrgPermission: vi.fn(),
  from: vi.fn(), rpc: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/utils/supabase/auth', () => ({
  getAuthedUser: mocks.getAuthedUser, assertOrgRole: mocks.assertOrgRole,
  assertOrgPermission: mocks.assertOrgPermission,
  createSessionClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc })),
}));
vi.mock('@/utils/supabase/serviceRole', () => ({ serviceRoleForAuthManagement: vi.fn(() => ({})) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
import { removeAccount } from './accounts';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthedUser.mockResolvedValue({ id: 'actor' });
  mocks.assertOrgPermission.mockResolvedValue({ userId: 'actor', isOwner: false });
  mocks.rpc.mockResolvedValue({ error: null });
});
function target(role: string) {
  const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { role }, error: null }) };
  query.eq.mockReturnValue(query);
  mocks.from.mockReturnValue({ select: vi.fn(() => query) });
}
describe('account removal authorization', () => {
  it('rejects non-owner removal of an owner before RPC', async () => {
    target('owner');
    mocks.assertOrgRole.mockRejectedValue(new Error('この操作を行う権限がありません'));
    await expect(removeAccount('org', { targetId: 'owner', status: 'active' })).rejects.toThrow('権限');
    expect(mocks.assertOrgRole).toHaveBeenCalledWith('org', ['owner']);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('allows account managers to remove general members', async () => {
    target('member');
    await removeAccount('org', { targetId: 'member', status: 'active' });
    expect(mocks.assertOrgPermission).toHaveBeenCalledWith('org', 'accounts');
    expect(mocks.rpc).toHaveBeenCalledWith('account_remove', expect.objectContaining({ p_target_id: 'member' }));
  });
  it('requires owner membership to remove another owner', async () => {
    target('owner');
    mocks.assertOrgRole.mockResolvedValue({ role: 'owner' });
    await removeAccount('org', { targetId: 'owner', status: 'active' });
    expect(mocks.assertOrgRole).toHaveBeenCalledWith('org', ['owner']);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.remove' }));
  });
  it('preserves self withdrawal without accounts permission', async () => {
    target('member');
    await removeAccount('org', { targetId: 'actor', status: 'active' });
    expect(mocks.assertOrgRole).toHaveBeenCalledWith('org');
    expect(mocks.assertOrgPermission).not.toHaveBeenCalled();
  });
  it('allows invitation cancellation without a member lookup', async () => {
    await removeAccount('org', { targetId: 'invite', status: 'invited' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.assertOrgPermission).toHaveBeenCalledWith('org', 'accounts');
  });
});
