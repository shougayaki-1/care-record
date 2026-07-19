import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertOrgPermission: vi.fn(),
  from: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({
  assertOrgPermission: mocks.assertOrgPermission,
  createSessionClient: vi.fn(async () => ({ from: mocks.from })),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { createClient, updateClientName } from './clients';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('client action authorization', () => {
  it('rejects createClient when the caller has no clients permission (unauthenticated/未許可)', async () => {
    mocks.assertOrgPermission.mockRejectedValue(new Error('この操作を行う権限がありません'));
    await expect(createClient('org-1', '山田太郎')).rejects.toThrow('この操作を行う権限がありません');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('allows an authorized caller to create a client and records the audit event', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: false });
    const insertQuery = { select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({
      data: { id: 'client-1', name: '山田太郎', created_at: '2026-01-01', archived_at: null }, error: null,
    }) })) };
    mocks.from.mockReturnValue({ insert: vi.fn(() => insertQuery) });

    await expect(createClient('org-1', '山田太郎')).resolves.toMatchObject({ id: 'client-1' });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', actorId: 'user-1', action: 'client.create', resourceId: 'client-1',
    }));
  });

  it('rejects updateClientName when a different organization\'s client id is supplied', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: true });
    const selectQuery: { eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
      // organization_id と id の両方に .eq() で絞り込むため、別組織のIDでは行がヒットしない
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    selectQuery.eq.mockReturnValue(selectQuery);
    mocks.from.mockReturnValue({ select: vi.fn(() => selectQuery) });

    await expect(updateClientName('org-1', 'other-org-client', '変更後')).rejects.toThrow('利用者が見つかりません');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects updateClientName for a soft-deleted client', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: true });
    const selectQuery: { eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'client-1', archived_at: '2026-01-01', deleted_at: '2026-01-02' }, error: null }),
    };
    selectQuery.eq.mockReturnValue(selectQuery);
    mocks.from.mockReturnValue({ select: vi.fn(() => selectQuery) });

    await expect(updateClientName('org-1', 'client-1', '変更後')).rejects.toThrow('利用者が見つかりません');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects updateClientName for a nonexistent client id', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: true });
    const selectQuery: { eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    selectQuery.eq.mockReturnValue(selectQuery);
    mocks.from.mockReturnValue({ select: vi.fn(() => selectQuery) });

    await expect(updateClientName('org-1', 'does-not-exist', '変更後')).rejects.toThrow('利用者が見つかりません');
  });

  it('allows updateClientName for a valid same-org, non-deleted client', async () => {
    mocks.assertOrgPermission.mockResolvedValue({ userId: 'user-1', isOwner: true });
    const selectQuery: { eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'client-1', archived_at: null, deleted_at: null }, error: null }),
    };
    selectQuery.eq.mockReturnValue(selectQuery);
    const updateQuery = { eq: vi.fn() };
    updateQuery.eq.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mocks.from.mockReturnValueOnce({ select: vi.fn(() => selectQuery) })
      .mockReturnValueOnce({ update: vi.fn(() => updateQuery) });

    await expect(updateClientName('org-1', 'client-1', '変更後')).resolves.toEqual({ success: true, name: '変更後' });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', actorId: 'user-1', action: 'client.rename', resourceId: 'client-1',
    }));
  });
});
