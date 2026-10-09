import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), permission: vi.fn(), audit: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertShiftPermission: mocks.permission, createSessionClient: async () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/supabase/retentionPolicy', () => ({ getRetentionPolicy: vi.fn(), retentionDeadline: vi.fn() }));
import { createShiftPattern, deleteShiftPattern, updateShiftPattern } from './patterns';
const payload = { organizationId: 'org', clientId: 'client', title: '訪問', startTime: '10:00', endTime: '11:00', rrule: 'FREQ=DAILY', segments: [] };
function target(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(async () => ({ data, error })) };
  mocks.from.mockReturnValue(q);
}
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ userId: 'actor', organizationId: 'org' }); });
describe('pattern result boundaries', () => {
  it.each(['update', 'delete'])('distinguishes missing pattern from failed read for %s', async mode => {
    const action = () => mode === 'update' ? updateShiftPattern('pattern', payload) : deleteShiftPattern('pattern');
    target(null);
    await expect(action()).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    target(null, { message: 'private_column 見つかりません SQL' });
    const result = await action();
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private_column');
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: null }, { data: null, error: { message: 'private RPC detail' } }])('does not report a successful creation without a pattern ID: %j', async response => {
    mocks.rpc.mockResolvedValue(response);
    await expect(createShiftPattern(payload)).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
