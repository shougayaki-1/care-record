import { readActionResult } from '@/utils/actionResult';
import { ExpectedActionError } from '@/utils/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ softDelete: vi.fn(), sync: vi.fn(), from: vi.fn(), permission: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ createSessionClient: vi.fn(async () => ({ from: mocks.from })),
  assertShiftPermission: mocks.permission, getEffectivePermissions: vi.fn(),
}));
vi.mock('./internal', () => ({ softDeleteShiftIds: mocks.softDelete, assertShiftsAccessible: vi.fn(),
  createShiftWithSegmentsAtomic: vi.fn(), upsertAssignmentsForStaffs: vi.fn(), updateShiftInternal: vi.fn(),
}));
vi.mock('./googleSyncInternal', () => ({ processShiftsSequential: mocks.sync, trySyncSilently: vi.fn() }));
vi.mock('../shiftSegments', () => ({ saveShiftSegments: vi.fn() }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
import { deleteShift as deleteShiftResult, deleteShiftsBatch as deleteShiftsBatchResult } from './crud';
import { emptyGoogleSyncStats } from '@/utils/googleSync';
beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.in.mockReturnValue(query);
  query.is.mockResolvedValue({ data: [{ id: 'shift' }], error: null });
  query.maybeSingle.mockResolvedValue({ data: { organization_id: 'org' }, error: null });
  mocks.from.mockReturnValue(query); mocks.softDelete.mockResolvedValue(1);
  mocks.sync.mockResolvedValue({ failed: 0, stats: emptyGoogleSyncStats() });
});
describe('local-first shift deletion', () => {
  it('commits deletion before contacting Google for single deletion', async () => {
    await deleteShift('shift');
    expect(mocks.softDelete.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
  });
  it.each(['auth', 'permanent', 'skipped'])('uses the same local deletion policy for %s', async errorKind => {
    mocks.sync.mockResolvedValue({ failed: errorKind === 'skipped' ? 0 : 1, errorKind, stats: emptyGoogleSyncStats() });
    const single = await deleteShift('shift');
    const batch = await deleteShiftsBatch('org', ['shift']);
    expect(single).toEqual(batch); expect(single.deleted).toBe(1); expect(single.success).toBe(true);
  });
  it('never contacts Google when retention policy or local deletion fails', async () => {
    mocks.softDelete.mockRejectedValue(new ExpectedActionError('VALIDATION_ERROR', 'シフトの保持方針が未承認のため削除できません'));
    await expect(deleteShift('shift')).rejects.toThrow('保持方針が未承認');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('rejects authorization failures before mutation or Google', async () => {
    mocks.permission.mockRejectedValue(new ExpectedActionError('FORBIDDEN', '権限がありません'));
    await expect(deleteShift('shift')).rejects.toThrow('権限');
    expect(mocks.softDelete).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
});

function deleteShift(...args: Parameters<typeof deleteShiftResult>) { return readActionResult(deleteShiftResult(...args)); }
function deleteShiftsBatch(...args: Parameters<typeof deleteShiftsBatchResult>) { return readActionResult(deleteShiftsBatchResult(...args)); }
