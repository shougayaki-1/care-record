import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

function makeQuery(rows: Row[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve: (result: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  };
  return query;
}

const mocks = vi.hoisted(() => ({ createSessionClient: vi.fn() }));

vi.mock('@/utils/supabase/auth', () => ({
  supabaseAdmin: {},
  createSessionClient: mocks.createSessionClient,
}));

import { FULL_PERMISSIONS, PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS } from '@/utils/permissions';
import { assertOwnerForDangerousPermissions, assertRoleManagerRemains, isDangerousPermissions } from './roleSafety';

describe('dangerous role permissions', () => {
  it('identifies the dangerous management permissions', () => {
    expect(isDangerousPermissions(PRESET_STAFF_PERMISSIONS)).toBe(false);
    expect(isDangerousPermissions(PRESET_MANAGER_PERMISSIONS)).toBe(false);
    expect(isDangerousPermissions(FULL_PERMISSIONS)).toBe(true);
  });

  it('rejects non-owners and permits owners for dangerous permissions', () => {
    expect(() => assertOwnerForDangerousPermissions(FULL_PERMISSIONS, false)).toThrow('オーナーのみ');
    expect(() => assertOwnerForDangerousPermissions(FULL_PERMISSIONS, true)).not.toThrow();
    expect(() => assertOwnerForDangerousPermissions(PRESET_MANAGER_PERMISSIONS, false)).not.toThrow();
  });
});

describe('assertRoleManagerRemains', () => {
  it('does not throw when the sole remaining member is the organization owner with no explicit role link', async () => {
    // Regression: a freshly created organization has an owner row in
    // organization_members but no organization_member_roles link yet. The DB
    // function private.has_management_permission still grants role management to
    // owners unconditionally, so this helper must match that behavior instead of
    // only inspecting organization_member_roles.
    mocks.createSessionClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === 'organization_roles') return makeQuery([]);
        if (table === 'organization_members') return makeQuery([{ user_id: 'owner-1', role: 'owner' }]);
        if (table === 'organization_member_roles') return makeQuery([]);
        throw new Error(`unexpected table ${table}`);
      }),
    });

    await expect(assertRoleManagerRemains('org-1')).resolves.toBeUndefined();
  });

  it('throws when no member (owner or otherwise) can manage roles', async () => {
    mocks.createSessionClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === 'organization_roles') return makeQuery([{ id: 'role-1', permissions: PRESET_STAFF_PERMISSIONS }]);
        if (table === 'organization_members') return makeQuery([{ user_id: 'member-1', role: 'member' }]);
        if (table === 'organization_member_roles') return makeQuery([{ user_id: 'member-1', role_id: 'role-1' }]);
        throw new Error(`unexpected table ${table}`);
      }),
    });

    await expect(assertRoleManagerRemains('org-1')).rejects.toThrow('ロールを管理できるメンバーが0人');
  });
});
