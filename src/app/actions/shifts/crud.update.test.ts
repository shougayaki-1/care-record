import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertShiftPermission: vi.fn(),
  from: vi.fn(),
  recordAuditEvent: vi.fn(),
  trySyncSilently: vi.fn(),
  updateShiftInternal: vi.fn(),
}));

vi.mock('@/utils/supabase/auth', () => ({
  assertShiftPermission: mocks.assertShiftPermission,
  createSessionClient: vi.fn(async () => ({ from: mocks.from })),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('./googleSyncInternal', () => ({
  trySyncSilently: mocks.trySyncSilently,
  processShiftsSequential: vi.fn(),
}));
vi.mock('./internal', () => ({
  createShiftWithSegmentsAtomic: vi.fn(),
  shiftDeleteFailureMessage: vi.fn(),
  shiftWriteFailureMessage: vi.fn(),
  softDeleteShiftIds: vi.fn(),
  upsertAssignmentsForStaffs: vi.fn(),
  updateShiftInternal: mocks.updateShiftInternal,
}));

import { updateShift } from './crud';

const ACTOR = { organizationId: 'org-1', userId: 'user-1', isOwner: false, clientIds: [], staffId: 'staff-1' };

function shiftLookup() {
  return {
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { organization_id: 'org-1' }, error: null }) }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue(shiftLookup());
  mocks.assertShiftPermission.mockResolvedValue(ACTOR);
  mocks.updateShiftInternal.mockResolvedValue({ success: true });
});

describe('updateShift audit and Google ordering', () => {
  it('does not start Google sync until the success audit has resolved', async () => {
    let releaseAudit!: () => void;
    mocks.recordAuditEvent.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseAudit = resolve; }));

    const pending = updateShift('shift-1', { title: 'ignored-by-db-title-refresh' });
    await vi.waitFor(() => expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();

    releaseAudit();
    await expect(pending).resolves.toEqual({ success: true });
    expect(mocks.trySyncSilently).toHaveBeenCalledWith('org-1', 'shift-1', 'sync');
  });

  it('records a failure audit and never starts Google sync when the atomic update fails', async () => {
    mocks.updateShiftInternal.mockRejectedValueOnce(new Error('atomic update failed'));

    await expect(updateShift('shift-1', { status: 'cancelled' })).rejects.toThrow();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    expect(mocks.trySyncSilently).not.toHaveBeenCalled();
  });
});
