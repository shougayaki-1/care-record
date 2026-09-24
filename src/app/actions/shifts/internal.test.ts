import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertShiftPermission: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  recordAuditEvent: vi.fn(),
  getRetentionPolicy: vi.fn(),
  trySyncSilently: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({
  assertShiftPermission: mocks.assertShiftPermission,
  createSessionClient: vi.fn(async () => ({ from: mocks.from, rpc: mocks.rpc })),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/utils/supabase/retentionPolicy', () => ({
  getRetentionPolicy: mocks.getRetentionPolicy,
  retentionDeadline: (years: number) => `deadline-${years}`,
}));
vi.mock('./googleSyncInternal', () => ({ trySyncSilently: mocks.trySyncSilently }));

import { shiftDeleteFailureMessage, shiftWriteFailureMessage, softDeleteShiftIds, updateShiftInternal } from './internal';

const ACTOR = { organizationId: 'org-1', userId: 'user-1', isOwner: false, clientIds: [], staffId: 'staff-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertShiftPermission.mockResolvedValue(ACTOR);
  mocks.getRetentionPolicy.mockResolvedValue({ years: 5, legalBasis: 'law' });
});

describe('shiftWriteFailureMessage / shiftDeleteFailureMessage', () => {
  it('maps known outcome codes to distinct Japanese messages', () => {
    expect(shiftWriteFailureMessage('not_found')).toContain('見つかりません');
    expect(shiftWriteFailureMessage('deleted')).toContain('削除済み');
    expect(shiftWriteFailureMessage('conflict')).toContain('競合');
    expect(shiftWriteFailureMessage('anything-unexpected')).toContain('競合');
  });
  it('distinguishes already_deleted from not_found for delete outcomes', () => {
    expect(shiftDeleteFailureMessage('not_found')).toContain('見つかりません');
    expect(shiftDeleteFailureMessage('already_deleted')).toContain('すでに削除');
  });
});

describe('softDeleteShiftIds', () => {
  it('returns an explicit no-op result without calling the RPC when there is nothing to delete', async () => {
    await expect(softDeleteShiftIds('org-1', [], '理由')).resolves.toEqual({
      requested: 0, matched: 0, deleted: 0, already_deleted: 0, failed: 0,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('records a success audit with the actual DB row count on success', async () => {
    mocks.rpc.mockResolvedValue({ data: { requested: 2, matched: 2, deleted: 2, already_deleted: 0, failed: 0 }, error: null });
    await expect(softDeleteShiftIds('org-1', ['s1', 's2'], '理由')).resolves.toMatchObject({ deleted: 2, already_deleted: 0 });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shift.bulk_soft_delete',
      details: expect.objectContaining({ requested: 2, deleted: 2 }),
    }));
    expect(mocks.recordAuditEvent.mock.calls[0][0].outcome).toBeUndefined();
  });

  it('never treats an incomplete checked result as success', async () => {
    mocks.rpc.mockResolvedValue({ data: { requested: 1, matched: 1, deleted: 0, already_deleted: 0, failed: 1 }, error: null });
    await expect(softDeleteShiftIds('org-1', ['s1'], '理由')).rejects.toThrow();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
  });

  it('does not create a new success audit when every target was already deleted', async () => {
    mocks.rpc.mockResolvedValue({ data: { requested: 2, matched: 2, deleted: 0, already_deleted: 2, failed: 0 }, error: null });
    await expect(softDeleteShiftIds('org-1', ['s1', 's2'], '理由')).resolves.toMatchObject({ already_deleted: 2 });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('records a failure audit and sanitizes the error when the RPC itself fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db exploded', code: 'XX000' } });
    await expect(softDeleteShiftIds('org-1', ['s1'], '理由')).rejects.not.toThrow('db exploded');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure', details: expect.objectContaining({ errorType: 'XX000' }),
    }));
  });
});

describe('updateShiftInternal', () => {
  const basePayload = { organizationId: 'org-1', clientId: 'client-1', title: 't', startAt: 'a', endAt: 'b' };

  it('throws before touching the DB when the org cannot be resolved', async () => {
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    });
    await expect(updateShiftInternal('shift-1', { title: 'x' })).rejects.toThrow('見つかりません');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('resolves success only when the RPC reports the row as updated, leaving sync to the audited public Action', async () => {
    mocks.rpc.mockResolvedValue({ data: 'updated', error: null });
    await expect(updateShiftInternal('shift-1', basePayload)).resolves.toEqual({ success: true });
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });

  it('rejects and skips sync when the RPC reports a non-updated outcome', async () => {
    mocks.rpc.mockResolvedValue({ data: 'conflict', error: null });
    await expect(updateShiftInternal('shift-1', basePayload)).rejects.toThrow('競合');
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });

  it('sanitizes a raw RPC error instead of leaking it, and skips sync', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'internal detail', code: '42501' } });
    await expect(updateShiftInternal('shift-1', basePayload)).rejects.toThrow();
    await expect(updateShiftInternal('shift-1', basePayload)).rejects.not.toThrow('internal detail');
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });

  it('skips calendar sync entirely when awaitSync is "skip"', async () => {
    mocks.rpc.mockResolvedValue({ data: 'updated', error: null });
    await expect(updateShiftInternal('shift-1', basePayload, 'skip')).resolves.toEqual({ success: true });
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });
});
