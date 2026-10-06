import { ExpectedActionError } from '@/utils/errors';
import { readActionResult } from '@/utils/actionResult';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertOwner: mocks.owner,
  createSessionClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc })),
}));
import { addOrganizationOwner } from './organizationOwners';
const org = '85000000-0000-4000-8000-000000000001';
const actor = '85000000-0000-4000-8000-000000000002';
const member = '85000000-0000-4000-8000-000000000003';
function query(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); return q;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.owner.mockResolvedValue({ userId: actor });
  mocks.from.mockImplementation(table => query(table === 'profiles' ? { deleted_at: null } : { role: 'member' }));
  mocks.rpc.mockResolvedValue({ error: null });
});
describe('owner addition Action', () => {
  it('delegates grant consumption and audit to the atomic RPC', async () => {
    await expect(readActionResult(addOrganizationOwner(org, member, 'proof'))).resolves.toEqual({ success: true });
    expect(mocks.owner).toHaveBeenCalledWith(org);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('add_organization_owner_atomic', {
      p_org_id: org, p_target_user_id: member, p_reauth_token: 'proof',
    });
  });
  it('rejects non-owners before querying or mutating', async () => {
    mocks.owner.mockRejectedValue(new ExpectedActionError('FORBIDDEN', 'オーナー権限が必要です'));
    await expect(readActionResult(addOrganizationOwner(org, member, 'proof'))).rejects.toThrow('権限');
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([['invalid', 'proof'], [member, ''], [actor, 'proof']])('rejects invalid target or proof %s', async (target, proof) => {
    await expect(readActionResult(addOrganizationOwner(org, target, proof))).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { role: 'owner' }])('rejects a non-member target', async data => {
    mocks.from.mockReturnValue(query(data));
    await expect(readActionResult(addOrganizationOwner(org, member, 'proof'))).rejects.toThrow('参加済み');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects deleted targets', async () => {
    mocks.from.mockImplementation(table => query(table === 'profiles' ? { deleted_at: '2026-10-01' } : { role: 'member' }));
    await expect(readActionResult(addOrganizationOwner(org, member, 'proof'))).rejects.toThrow('利用できません');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('shows safe reauth errors and hides unexpected database details', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'owner_add_requires_reauthentication' } });
    await expect(readActionResult(addOrganizationOwner(org, member, 'proof'))).rejects.toThrow('もう一度再認証');
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'sensitive database detail' } });
    await expect(readActionResult(addOrganizationOwner(org, member, 'proof'))).rejects.toThrow('処理に失敗しました');
  });
});
