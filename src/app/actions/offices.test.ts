import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAssertOrgRole = vi.fn();
const mockAssertOrgPermission = vi.fn();
const mockFrom = vi.fn();
const mockRecordAuditEvent = vi.fn();
const mockSanitizeDbError = vi.fn((error) => error || new Error('Database error'));

vi.mock('@/utils/supabase/auth', () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
  assertOrgPermission: (...args: unknown[]) => mockAssertOrgPermission(...args),
  supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}));
vi.mock('@/utils/supabase/audit', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));
vi.mock('@/utils/errors', () => ({
  sanitizeDbError: (error: unknown) => mockSanitizeDbError(error),
}));

import { getOffices, createOffice, updateOffice, archiveOffice } from './offices';

describe('offices actions', () => {
  const orgId = 'org-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertOrgRole.mockResolvedValue({ userId: 'user-1' });
    mockAssertOrgPermission.mockResolvedValue({ userId: 'user-1' });
  });

  it('getOffices: アーカイブ済みを除外して一覧取得する', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'o1', organization_id: orgId, name: '本社', travel_cost_rate_yen_per_km: 20, archived_at: null, created_at: '2026-01-01' }],
      error: null,
    });
    const is = vi.fn().mockReturnValue({ order });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });

    const result = await getOffices(orgId);

    expect(mockAssertOrgRole).toHaveBeenCalledWith(orgId);
    expect(mockFrom).toHaveBeenCalledWith('offices');
    expect(is).toHaveBeenCalledWith('archived_at', null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('本社');
  });

  it('createOffice: 単価が範囲外だとエラーになる', async () => {
    await expect(createOffice(orgId, '第二事業所', -1)).rejects.toThrow('交通費単価は0〜10000円で入力してください');
    await expect(createOffice(orgId, '第二事業所', 10001)).rejects.toThrow('交通費単価は0〜10000円で入力してください');
  });

  it('createOffice: 正常系で作成し監査ログを記録する', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'o2', organization_id: orgId, name: '第二事業所', travel_cost_rate_yen_per_km: 25, archived_at: null, created_at: '2026-01-02' },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    mockFrom.mockReturnValue({ insert });

    const result = await createOffice(orgId, '第二事業所', 25);

    expect(mockAssertOrgPermission).toHaveBeenCalledWith(orgId, 'organization');
    expect(insert).toHaveBeenCalledWith({ organization_id: orgId, name: '第二事業所', travel_cost_rate_yen_per_km: 25 });
    expect(result.name).toBe('第二事業所');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'office.create' }));
  });

  it('updateOffice: 権限チェックのうえ更新する', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    mockFrom.mockReturnValue({ update });

    await updateOffice(orgId, 'o1', { name: '本社(改称)', travel_cost_rate_yen_per_km: 30 });

    expect(mockAssertOrgPermission).toHaveBeenCalledWith(orgId, 'organization');
    expect(update).toHaveBeenCalledWith({ name: '本社(改称)', travel_cost_rate_yen_per_km: 30 });
  });

  it('archiveOffice: archived_atを設定する', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    mockFrom.mockReturnValue({ update });

    await archiveOffice(orgId, 'o1');

    expect(mockAssertOrgPermission).toHaveBeenCalledWith(orgId, 'organization');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
  });
});
