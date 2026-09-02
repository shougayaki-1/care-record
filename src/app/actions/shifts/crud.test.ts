import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertShiftPermission: vi.fn(),
  getEffectivePermissions: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  recordAuditEvent: vi.fn(),
  getRetentionPolicy: vi.fn(),
  trySyncSilently: vi.fn(),
  processShiftsSequential: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({
  assertShiftPermission: mocks.assertShiftPermission,
  getEffectivePermissions: mocks.getEffectivePermissions,
  createSessionClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc })),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/utils/supabase/retentionPolicy', () => ({
  getRetentionPolicy: mocks.getRetentionPolicy,
  retentionDeadline: (years: number) => `deadline-${years}`,
}));
vi.mock('./googleSyncInternal', () => ({
  trySyncSilently: mocks.trySyncSilently,
  processShiftsSequential: mocks.processShiftsSequential,
}));

import { deleteShiftCompletely, deleteShiftsDbOnly, toggleCancelShift, updateShiftTimeOnly } from './crud';

const ACTOR = { organizationId: 'org-1', userId: 'user-1', isOwner: false, clientIds: [], staffId: 'staff-1' };

/** supabase-js のクエリビルダを模した、任意のメソッドチェーン末尾で result に解決する thenable proxy。 */
function chainable(result: { data: unknown; error: unknown }): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function mockShiftsFrom(result: { data: unknown; error: unknown }) {
  mocks.from.mockImplementation(() => chainable(result));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertShiftPermission.mockResolvedValue(ACTOR);
  mocks.getRetentionPolicy.mockResolvedValue({ years: 5, legalBasis: 'law' });
});

describe('updateShiftTimeOnly', () => {
  it('rejects with a not-found message before any permission check when the shift is missing', async () => {
    mockShiftsFrom({ data: null, error: null });
    await expect(updateShiftTimeOnly('shift-1', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).rejects.toThrow('見つかりません');
    expect(mocks.assertShiftPermission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('shows success toast-worthy state only when the RPC actually updated a row', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'updated', error: null });

    await expect(updateShiftTimeOnly('shift-1', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).resolves.toEqual({ success: true });

    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'shift.time_update', resourceId: 'shift-1' }));
    expect(mocks.recordAuditEvent.mock.calls[0][0].outcome).toBeUndefined();
    expect(mocks.trySyncSilently).toHaveBeenCalledWith('org-1', 'shift-1', 'sync');
  });

  it('never reports success when the atomic RPC rejects the write for insufficient permission scope', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    // RPC自身がscope!=='all'（assigned/none）を検出した場合は例外（RPC error）で返る。
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shift edit permission required', code: 'P0001' } });

    await expect(updateShiftTimeOnly('shift-1', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).rejects.not.toThrow('shift edit permission required');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });

  it('never reports success for a zero-row conflict outcome and does not sync', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'conflict', error: null });

    await expect(updateShiftTimeOnly('shift-1', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).rejects.toThrow();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure', details: expect.objectContaining({ reasonCode: 'conflict' }),
    }));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });

  it('rejects when the shift was already soft-deleted (outcome "deleted") and does not sync', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'deleted', error: null });

    await expect(updateShiftTimeOnly('shift-1', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')).rejects.toThrow('削除済み');
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });
});

describe('toggleCancelShift', () => {
  it('audits shift.cancel with the reason only after a real DB update, then syncs', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'updated', error: null });

    await expect(toggleCancelShift('shift-1', true, '体調不良')).resolves.toEqual({ success: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'shift.cancel', reason: '体調不良' }));
    expect(mocks.recordAuditEvent.mock.calls[0][0].outcome).toBeUndefined();
    expect(mocks.trySyncSilently).toHaveBeenCalledWith('org-1', 'shift-1', 'sync');
  });

  it('does not audit success or sync when the RPC reports zero rows changed', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'conflict', error: null });

    await expect(toggleCancelShift('shift-1', true, '体調不良')).rejects.toThrow();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'shift.cancel', outcome: 'failure' }));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });
});

describe('deleteShiftCompletely', () => {
  it('marks success and syncs the deletion to Google only after the DB row is actually deleted', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'deleted', error: null });

    await expect(deleteShiftCompletely('shift-1')).resolves.toEqual({ success: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'shift.soft_delete' }));
    expect(mocks.recordAuditEvent.mock.calls[0][0].outcome).toBeUndefined();
    expect(mocks.trySyncSilently).toHaveBeenCalledWith('org-1', 'shift-1', 'delete');
  });

  it('distinguishes "already deleted" from a generic failure and never calls Google sync', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: 'already_deleted', error: null });

    await expect(deleteShiftCompletely('shift-1')).rejects.toThrow('すでに削除');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure', details: expect.objectContaining({ reasonCode: 'already_deleted' }),
    }));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });

  it('sanitizes a raw DB error rather than exposing it, and records a failure audit', async () => {
    mockShiftsFrom({ data: { organization_id: 'org-1' }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation shifts does not exist', code: '42P01' } });

    await expect(deleteShiftCompletely('shift-1')).rejects.not.toThrow('relation shifts does not exist');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure', details: expect.objectContaining({ errorType: '42P01' }),
    }));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });
});

describe('deleteShiftsDbOnly', () => {
  it('reports the actual deleted row count and audits success only once the RPC confirms it', async () => {
    mocks.from.mockReturnValue(chainable({
      data: [{ id: 's1', organization_id: 'org-1' }, { id: 's2', organization_id: 'org-1' }],
      error: null,
    }));
    mocks.rpc.mockResolvedValue({ data: 2, error: null });

    await expect(deleteShiftsDbOnly(['s1', 's2'])).resolves.toEqual({ success: true, deleted: 2 });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shift.bulk_soft_delete', details: expect.objectContaining({ requested: 2, deleted: 2 }),
    }));
    expect(mocks.recordAuditEvent.mock.calls[0][0].outcome).toBeUndefined();
  });

  it('never reports success when the RPC deletes zero rows', async () => {
    mocks.from.mockReturnValue(chainable({ data: [{ id: 's1', organization_id: 'org-1' }], error: null }));
    mocks.rpc.mockResolvedValue({ data: 0, error: null });

    await expect(deleteShiftsDbOnly(['s1'])).rejects.toThrow();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
  });
});
