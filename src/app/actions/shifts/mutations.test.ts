import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({
  results: [] as Result[],
  queries: [] as Array<{ update: unknown; filters: Record<string, unknown>; select?: string }>,
  assertPermission: vi.fn(), rpc: vi.fn(), audit: vi.fn(), sync: vi.fn(), process: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
  assertShiftPermission: mocks.assertPermission,
  getEffectivePermissions: vi.fn(),
  createSessionClient: async () => ({
    rpc: mocks.rpc,
    from: () => {
      const recorded: typeof mocks.queries[number] = { update: null, filters: {} };
      mocks.queries.push(recorded);
      const respond = () => {
        const result = mocks.results.shift();
        if (!result) throw new Error('Unexpected query');
        return Promise.resolve(result);
      };
      const query = {
        update: (value: unknown) => { recorded.update = value; return query; },
        select: (value: string) => { recorded.select = value; return query; },
        eq: (key: string, value: unknown) => { recorded.filters[key] = value; return query; },
        is: (key: string, value: unknown) => { recorded.filters[key] = value; return query; },
        in: (key: string, value: unknown) => { recorded.filters[key] = value; return query; },
        single: respond, maybeSingle: respond,
        then: (resolve: (value: Result) => unknown) => respond().then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/supabase/retentionPolicy', () => ({
  getRetentionPolicy: async () => ({ years: 10, legalBasis: 'test-policy' }),
  retentionDeadline: () => '2036-01-01T00:00:00Z',
}));
vi.mock('../shiftSegments', () => ({ saveShiftSegments: vi.fn() }));
vi.mock('./googleSyncInternal', () => ({
  trySyncSilently: mocks.sync, processShiftsSequential: mocks.process,
}));

import { deleteShift, deleteShiftsBatch, deleteShiftsDbOnly, toggleCancelShift, updateShift, updateShiftTimeOnly } from './crud';
import { softDeleteShiftIds, updateShiftInternal } from './internal';

const existing = { organization_id: 'org-1' };
const success = { data: { id: 'shift-1', ...existing }, error: null };
const inaccessible = { data: null, error: null };
// Includes a normally allowlisted word to ensure DB details cannot escape withSafeError.
const dbError = { data: null, error: { message: '権限: internal SQL detail', code: '42501' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results.length = 0;
  mocks.queries.length = 0;
  mocks.assertPermission.mockResolvedValue({ organizationId: 'org-1', userId: 'user-1' });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  mocks.sync.mockResolvedValue(undefined);
  mocks.process.mockResolvedValue({ failed: 0, stats: {} });
});

const updates = [
  { name: 'time', action: () => updateShiftTimeOnly('shift-1', 'start', 'end'), audit: 'shift.time_update' },
  { name: 'cancel', action: () => toggleCancelShift('shift-1', true, 'test reason'), audit: 'shift.cancel' },
  { name: 'reopen', action: () => toggleCancelShift('shift-1', false), audit: 'shift.reopen' },
  { name: 'update', action: () => updateShift('shift-1', { startAt: 'start' }), audit: 'shift.update' },
];
function queueUpdate(name: string, mutation: Result) {
  mocks.results.push({ data: existing, error: null });
  if (name === 'update') mocks.results.push(inaccessible); // optional title lookup
  mocks.results.push(mutation);
}

describe.each(updates)('$name mutation result', ({ name, action, audit }) => {
  it('syncs and audits only after an actual update', async () => {
    queueUpdate(name, success);
    await expect(action()).resolves.toEqual({ success: true });
    expect(mocks.sync).toHaveBeenCalledWith('org-1', 'shift-1', 'sync');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: audit }));
    expect(mocks.queries.find(query => query.update)?.filters).toEqual({
      id: 'shift-1', organization_id: 'org-1', deleted_at: null,
    });
    expect(mocks.queries.find(query => query.update)?.select).toContain('id');
  });
  it.each([['zero rows / concurrent deletion', inaccessible], ['DB denial/error', dbError]] as const)(
    'rejects %s without sync or success audit', async (_, result) => {
      queueUpdate(name, result);
      await expect(action()).rejects.toThrow();
      expect(mocks.sync).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );
  it.each(['missing', 'already deleted', 'other tenant'])('rejects an RLS-hidden %s target before mutation', async () => {
    mocks.results.push(inaccessible);
    await expect(action()).rejects.toThrow('見つかりません');
    expect(mocks.queries.some(query => query.update)).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects application permission denial before mutation', async () => {
    mocks.results.push({ data: existing, error: null });
    mocks.assertPermission.mockRejectedValue(new Error('この操作を行う権限がありません'));
    await expect(action()).rejects.toThrow('権限');
    expect(mocks.queries.some(query => query.update)).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('sanitizes DB errors even if they contain an allowlisted word', async () => {
    queueUpdate(name, dbError);
    await expect(action()).rejects.toThrow('処理に失敗しました。時間をおいて再度お試しください。');
  });
});

describe('internal update', () => {
  it.each([true, false, 'skip'] as const)('rejects zero rows before sync mode %s', async mode => {
    mocks.results.push(inaccessible);
    await expect(updateShiftInternal('shift-1', { organizationId: 'org-1' }, mode)).rejects.toThrow('更新できません');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it.each([true, false, 'skip'] as const)('preserves sync mode %s on success', async mode => {
    mocks.results.push(success);
    await expect(updateShiftInternal('shift-1', { organizationId: 'org-1' }, mode)).resolves.toEqual({ success: true });
    expect(mocks.sync).toHaveBeenCalledTimes(mode === 'skip' ? 0 : 1);
  });
});

const deletions = [
  { name: 'single', action: () => deleteShift('shift-1'), audit: 'shift.bulk_soft_delete' },
  { name: 'DB only', action: () => deleteShiftsDbOnly(['shift-1']), audit: 'shift.bulk_soft_delete' },
  { name: 'internal batch', action: () => softDeleteShiftIds('org-1', ['shift-1'], 'test reason'), audit: 'shift.bulk_soft_delete' },
];
function queueDelete(name: string) {
  if (name === 'single') {
    const rows = { data: [{ id: 'shift-1', ...existing }], error: null };
    mocks.results.push({ data: existing, error: null }, rows, rows);
  }
  if (name === 'DB only') {
    const rows = { data: [{ id: 'shift-1', ...existing }], error: null };
    mocks.results.push(rows, rows);
  }
}
describe.each(deletions)('$name deletion result', ({ name, action, audit }) => {
  it('uses authorized ROW_COUNT and preserves audit and sync status', async () => {
    queueDelete(name);
    await action();
    expect(mocks.rpc).toHaveBeenCalledWith('soft_delete_shifts_atomic', expect.objectContaining({
      p_org_id: 'org-1', p_shift_ids: ['shift-1'], p_sync_status: 'pending_delete',
      p_retention_until: '2036-01-01T00:00:00Z',
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: audit }));
    expect(mocks.process).toHaveBeenCalledTimes(name === 'single' ? 1 : 0);
  });
  it.each([0, null, 2])('rejects unexpected updated count %s without success audit', async count => {
    queueDelete(name);
    mocks.rpc.mockResolvedValue({ data: count, error: null });
    await expect(action()).rejects.toThrow('削除できません');
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('sanitizes DB denial without success audit', async () => {
    queueDelete(name);
    mocks.rpc.mockResolvedValue(dbError);
    await expect(action()).rejects.toThrow('処理に失敗しました。時間をおいて再度お試しください。');
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('rejects application permission denial before RPC and Google', async () => {
    queueDelete(name);
    mocks.assertPermission.mockRejectedValue(new Error('権限がありません'));
    await expect(action()).rejects.toThrow('権限');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('deletion edge cases', () => {
  it('keeps confirmed deletion audited and reports pending Google sync on remote failure', async () => {
    queueDelete('single');
    mocks.process.mockResolvedValue({ failed: 1, errorKind: 'transient', stats: {} });
    await expect(deleteShift('shift-1')).resolves.toMatchObject({ success: true, deleted: 1, failed: 1 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'shift.bulk_soft_delete' }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]!);
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.process.mock.invocationCallOrder[0]!);
  });
  it('does not contact Google when the deletion audit cannot be recorded', async () => {
    queueDelete('single');
    mocks.audit.mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(deleteShift('shift-1')).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it.each(['single', 'DB only'])('rejects hidden / deleted / other tenant %s targets', async name => {
    mocks.results.push(name === 'single' ? inaccessible : { data: [], error: null });
    await expect(deletions.find(item => item.name === name)!.action()).rejects.toThrow('見つかりません');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects a target disappearing between batch preflight and fetch', async () => {
    mocks.results.push({ data: [{ id: 'shift-1', ...existing }], error: null }, { data: [], error: null });
    await expect(deleteShiftsDbOnly(['shift-1'])).rejects.toThrow('見つかりません');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rejects partial batch deletion instead of auditing the full requested set', async () => {
    const rows = { data: [{ id: 'shift-1', ...existing }, { id: 'shift-2', ...existing }], error: null };
    mocks.results.push(rows, rows);
    await expect(deleteShiftsDbOnly(['shift-1', 'shift-2'])).rejects.toThrow('削除できません');
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('preserves the empty batch no-op', async () => {
    mocks.results.push({ data: [], error: null });
    await expect(deleteShiftsDbOnly([])).resolves.toEqual({ success: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});


describe('batch deletion preflight race', () => {
  it.each([
    { data: [], error: null },
    { data: [{ id: 'shift-1' }], error: null },
    dbError,
  ])('rejects disappearing targets or a failed second read before deletion', async result => {
    mocks.results.push({ data: [{ id: 'shift-1', ...existing }, { id: 'shift-2', ...existing }], error: null }, result);
    await expect(deleteShiftsBatch('org-1', ['shift-1', 'shift-2'])).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('preserves the explicit empty batch result', async () => {
    await expect(deleteShiftsBatch('org-1', [])).resolves.toMatchObject({ success: true, deleted: 0, failed: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
