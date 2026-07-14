import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertOrgPermission: vi.fn(),
  from: vi.fn(),
  recordAuditEvent: vi.fn(),
  assertRoleManagerRemains: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({
  assertOrgPermission: mocks.assertOrgPermission,
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/utils/supabase/roleSafety', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/supabase/roleSafety')>();
  return { ...actual, assertRoleManagerRemains: mocks.assertRoleManagerRemains };
});

import { FULL_PERMISSIONS, PRESET_MANAGER_PERMISSIONS } from '@/utils/permissions';
import { createOrgRole, updateOrgRole } from './roles';

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
    const single = vi.fn().mockResolvedValue({ data: { id: 'role-1' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockReturnValue({ insert });

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
    const single = vi.fn().mockResolvedValue({ data: { id: 'role-safe' }, error: null });
    mocks.from.mockReturnValue({ insert: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) });
    await expect(createOrgRole('org-1', '通常管理者', null, PRESET_MANAGER_PERMISSIONS)).resolves.toEqual({ id: 'role-safe' });
  });
});
