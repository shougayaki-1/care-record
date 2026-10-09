import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';
import { getServiceTypes, createServiceType } from './serviceTypes';
import { getStaffRoles } from './staffRoles';
import { getShiftSegments } from './shiftSegments';
import { getSyncStatus } from './shifts/googleSync';

const mocks = vi.hoisted(() => ({ role: vi.fn(), permission: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
  assertOrgRole: mocks.role, assertOrgPermission: mocks.permission, assertShiftPermission: mocks.permission,
  createSessionClient: async () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/utils/log', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/log')>(), logError: vi.fn(),
}));

function query(data: unknown, error: unknown = null, count: number | null = null) {
  const result = { data, error, count };
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), or: vi.fn(),
    single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of [builder.select, builder.eq, builder.is, builder.order, builder.or]) method.mockReturnValue(builder);
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ userId: 'user-1', role: 'member' });
  mocks.permission.mockResolvedValue({ userId: 'user-1', isOwner: true });
});

describe.each([
  { name: 'service types', read: () => getServiceTypes('org-1') },
  { name: 'staff roles', read: () => getStaffRoles('org-1') },
])('$name public read result', ({ read }) => {
  it('returns success [] for zero rows with the same organization and deleted filters', async () => {
    const builder = query([]);
    mocks.from.mockReturnValue(builder);
    await expect(read()).resolves.toEqual({ ok: true, data: [] });
    expect(builder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
  });
  it('returns a classified denial before querying data', async () => {
    mocks.role.mockRejectedValue(new ExpectedActionError('FORBIDDEN', 'この事業所へのアクセス権がありません'));
    await expect(read()).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not treat a DB failure as zero master rows', async () => {
    mocks.from.mockReturnValue(query(null, { message: 'private_column 権限 detail' }));
    const result = await read();
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private_column');
  });
});

describe('resource reads and mutations', () => {
  it.each([
    { data: null, error: null, code: 'NOT_FOUND' },
    { data: null, error: { message: 'private shift detail' }, code: 'UNEXPECTED_ERROR' },
  ])('distinguishes an RLS-hidden shift from a failed target query: $code', async ({ data, error, code }) => {
    mocks.from.mockReturnValue(query(data, error));
    await expect(getShiftSegments('org-1', 'shift-1')).resolves.toMatchObject({ ok: false, error: { code } });
    expect(mocks.from).toHaveBeenCalledOnce();
  });
  it('does not issue a master mutation after a classified authorization denial', async () => {
    mocks.permission.mockRejectedValue(new ExpectedActionError('FORBIDDEN', 'この操作を行う権限がありません'));
    await expect(createServiceType('org-1', 'サービス')).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('sync status', () => {
  it.each(['connection', 'total', 'unsynced'])('does not turn a %s query failure into disconnected or zero counts', async failed => {
    mocks.from.mockReturnValueOnce(query({ google_calendar_id: 'calendar', google_refresh_token: 'synthetic' }, failed === 'connection' ? { message: 'private detail' } : null))
      .mockReturnValueOnce(query(null, failed === 'total' ? { message: 'private detail' } : null, 1))
      .mockReturnValueOnce(query(null, failed === 'unsynced' ? { message: 'private detail' } : null, 1));
    await expect(getSyncStatus('org-1')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  });
});
