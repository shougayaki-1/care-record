import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertOrgPermission: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  recordAuditEvent: vi.fn(),
  assertRoleManagerRemains: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({
  assertOrgPermission: mocks.assertOrgPermission,
  createSessionClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc })),
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/utils/supabase/roleSafety', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/supabase/roleSafety')>();
  return { ...actual, assertRoleManagerRemains: mocks.assertRoleManagerRemains };
});

import { FULL_PERMISSIONS, PRESET_MANAGER_PERMISSIONS } from '@/utils/permissions';
import { createOrgRole, updateOrgRole, deleteOrgRole } from './roles';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('role action security', () => {
  it('rejects dangerous role creation by a non-owner before writing', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: false });
    await expect(createOrgRole('org-1', '危険ロール', null, FULL_PERMISSIONS)).rejects.toThrow('オーナーのみ');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('allows an owner to create a dangerous role and records the permission change', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'owner-1', isOwner: true });
    mocks.rpc.mockResolvedValue({ data: 'role-1', error: null });

    await expect(createOrgRole('org-1', '管理ロール', '#fff', FULL_PERMISSIONS)).resolves.toEqual({ id: 'role-1' });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', actorId: 'owner-1', action: 'role.create', resourceId: 'role-1',
      details: expect.objectContaining({ permissionDiff: expect.objectContaining({ 'management.accounts': { before: null, after: true } }) }),
    }));
  });

  it('checks effective existing permissions when a non-owner updates only metadata', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: false });
    const query: { eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { name: '危険', color: null, permissions: FULL_PERMISSIONS }, error: null }),
    };
    query.eq.mockReturnValue(query);
    mocks.from.mockReturnValue({ select: vi.fn(() => query) });

    await expect(updateOrgRole('org-1', 'role-1', { name: '変更後' })).rejects.toThrow('オーナーのみ');
    expect(mocks.assertRoleManagerRemains).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('allows a non-owner to create a role without dangerous management permissions', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: false });
    mocks.rpc.mockResolvedValue({ data: 'role-safe', error: null });
    await expect(createOrgRole('org-1', '通常管理者', null, PRESET_MANAGER_PERMISSIONS)).resolves.toEqual({ id: 'role-safe' });
  });
});


describe('role deletion security', () => {
  it.each([
    { isOwner: false, isPreset: true, permissions: PRESET_MANAGER_PERMISSIONS, message: 'プリセット' },
    { isOwner: true, isPreset: true, permissions: FULL_PERMISSIONS, message: 'プリセット' },
    { isOwner: false, isPreset: false, permissions: FULL_PERMISSIONS, message: 'オーナーのみ' },
  ])('rejects protected deletion before RPC ($isOwner / $isPreset)', async ({ isOwner, isPreset, permissions, message }) => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'actor', isOwner });
    const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Protected', color: null, permissions, is_preset: isPreset }, error: null }) };
    query.eq.mockReturnValue(query);
    mocks.from.mockReturnValue({ select: vi.fn(() => query) });
    await expect(deleteOrgRole('org', 'role')).rejects.toThrow(message);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it.each([true, false])('allows permitted deletion and checks remaining managers (owner: %s)', async isOwner => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'actor', isOwner });
    const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Safe', color: null, permissions: isOwner ? FULL_PERMISSIONS : PRESET_MANAGER_PERMISSIONS, is_preset: false }, error: null }) };
    query.eq.mockReturnValue(query);
    mocks.from.mockReturnValue({ select: vi.fn(() => query) });
    mocks.rpc.mockResolvedValue({ error: null });
    await deleteOrgRole('org', 'role');
    expect(mocks.assertRoleManagerRemains).toHaveBeenCalledWith('org', { deletedRoleId: 'role' });
    expect(mocks.rpc).toHaveBeenCalledWith('mutate_organization_role_authorized', expect.objectContaining({ p_action: 'delete' }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.delete' }));
  });
});
