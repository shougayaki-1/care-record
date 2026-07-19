import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertSuperAdmin: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({ assertSuperAdmin: mocks.assertSuperAdmin }));
vi.mock('@/utils/supabase/serviceRole', () => ({ serviceRoleForPlatformMetadata: () => ({ from: mocks.from }) }));

import { deleteOrganization, getAllOrganizations } from './super-admin';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('super-admin action authorization', () => {
  it('rejects getAllOrganizations for a non-super-admin caller', async () => {
    mocks.assertSuperAdmin.mockRejectedValue(new Error('管理者権限が必要です'));
    await expect(getAllOrganizations()).rejects.toThrow('管理者権限が必要です');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  // 3省2ガイドライン: super adminはアプリ内のどの経路からも顧客の記録本文・
  // ファイルを取得できない（service-role-operations.jsonのserviceRoleForPlatformMetadata
  // の想定と一致させる回帰ガード）。
  it('only selects organization identifiers and aggregate counts, never record content columns', async () => {
    mocks.assertSuperAdmin.mockResolvedValue(undefined);
    const selectSpy = vi.fn((columns: string) => {
      void columns;
      return {
        is: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      };
    });
    mocks.from.mockReturnValue({ select: selectSpy });

    await getAllOrganizations();

    expect(mocks.from).toHaveBeenCalledWith('organizations');
    const selectedColumns = selectSpy.mock.calls[0][0];
    for (const forbidden of ['reports', 'clients (id', 'clients (name', 'form_templates', 'record']) {
      expect(selectedColumns).not.toContain(forbidden);
    }
    expect(selectedColumns).toMatch(/clients \(count\)/);
  });

  it('never allows super admin to delete a customer organization (no content-adjacent deletion path)', async () => {
    mocks.assertSuperAdmin.mockResolvedValue(undefined);
    await expect(deleteOrganization('org-1')).rejects.toThrow('super adminから顧客事業所を削除できません');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
