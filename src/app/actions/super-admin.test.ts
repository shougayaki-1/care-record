import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), from: vi.fn(), select: vi.fn(), is: vi.fn(), order: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertSuperAdmin: mocks.guard }));
vi.mock('@/utils/supabase/serviceRole', () => ({ serviceRoleForPlatformMetadata: () => ({ from: mocks.from }) }));
import { deleteOrganization, getAllOrganizations } from './super-admin';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ userId: 'super-admin' });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ is: mocks.is });
  mocks.is.mockReturnValue({ order: mocks.order });
});

describe('super-admin metadata boundary', () => {
  it.each(['UNAUTHENTICATED', 'FORBIDDEN'] as const)('rejects %s before querying', async code => {
    mocks.guard.mockRejectedValue(new ExpectedActionError(code, 'アクセスできません'));
    await expect(getAllOrganizations()).resolves.toMatchObject({ ok: false, error: { code } });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('queries only approved metadata and returns only approved fields', async () => {
    mocks.order.mockResolvedValue({ data: [{ id: 'org', name: 'Office', created_at: 'date', profiles: { count: 2 }, clients: [{ count: 3 }], secret: 'hidden' }], error: null });
    await expect(getAllOrganizations()).resolves.toEqual({ ok: true, data: [{ id: 'org', name: 'Office', createdAt: 'date', staffCount: 2, clientCount: 3 }] });
    expect(mocks.from.mock.calls).toEqual([['organizations']]);
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.select.mock.calls[0][0].replace(/\s/g, '')).toBe('id,name,created_at,profiles(count),clients(count)');
    expect(mocks.is).toHaveBeenCalledWith('deleted_at', null);
    expect(mocks.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('rejects deletion even for a super-admin without accessing the database', async () => {
    await expect(deleteOrganization('org')).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
