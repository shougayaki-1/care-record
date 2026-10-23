// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShiftMonthOperations } from './useShiftMonthOperations';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), generate: vi.fn(), remove: vi.fn(), from: vi.fn() }));
vi.mock('@/app/actions/shift', () => ({ previewShiftsForMonth: mocks.preview, generateShiftsForMonth: mocks.generate, deleteShiftsBatch: mocks.remove }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
const preview = { total: 2, details: [{ title: '夜勤', count: 2, isOvernight: true }] };
const failure = { ok: false, error: { code: 'FORBIDDEN', message: 'この操作を行う権限がありません' } };
const options = () => ({ currentOrg: { id: 'org-1' }, targetMonth: '2026-02', mastersReady: true,
  showToast: vi.fn(), onRefresh: vi.fn(), onGenerated: vi.fn(), runUnsyncedSyncLoop: vi.fn().mockResolvedValue(true) });
function query(rows: { id: string; title: string }[] = [], error: unknown = null) {
  const q = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), not: vi.fn(), or: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve) };
  for (const key of ['select', 'eq', 'is', 'not', 'or'] as const) q[key].mockReturnValue(q);
  mocks.from.mockReturnValue(q);
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.preview.mockResolvedValue({ ok: true, data: preview });
  mocks.generate.mockResolvedValue({ ok: true, data: { count: 2, updated: 3, skipped: 1, failed: 0 } });
  mocks.remove.mockResolvedValue({ ok: true, data: { deleted: 1, failed: 0 } });
  query();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('opens a preview without generating and closing it never generates', async () => {
  const { result } = renderHook(() => useShiftMonthOperations(options()));
  await act(async () => { await result.current.handleCalculatePreview(); });
  expect(mocks.preview).toHaveBeenCalledWith('org-1', '2026-02');
  expect(result.current.previewDialogOpen).toBe(true);
  expect(result.current.previewDetails).toEqual(preview);
  act(() => result.current.closePreview());
  expect(result.current.previewDialogOpen).toBe(false);
  expect(mocks.generate).not.toHaveBeenCalled();
});
it('reports preview failure without opening confirmation or generating', async () => {
  mocks.preview.mockResolvedValue(failure);
  const opts = options();
  const { result } = renderHook(() => useShiftMonthOperations(opts));
  await act(async () => { await result.current.handleCalculatePreview(); });
  expect(result.current.generating).toBe(false);
  expect(result.current.previewDialogOpen).toBe(false);
  expect(opts.showToast).toHaveBeenCalledWith(failure.error.message, 'error');
  expect(mocks.generate).not.toHaveBeenCalled();
});
it.each([0, 1])('generates only on confirmation and preserves partial failure=%i reporting and sync', async failed => {
  mocks.generate.mockResolvedValue({ ok: true, data: { count: 2, updated: 3, skipped: 1, failed } });
  const opts = options(); const { result } = renderHook(() => useShiftMonthOperations(opts));
  await act(async () => { await result.current.handleCalculatePreview(); });
  await act(async () => { await result.current.executeGenerate(); });
  expect(mocks.generate).toHaveBeenCalledWith('org-1', '2026-02');
  expect(result.current.previewDialogOpen).toBe(false);
  expect(opts.onGenerated).toHaveBeenCalledOnce();
  expect(opts.runUnsyncedSyncLoop).toHaveBeenCalledOnce();
  expect(opts.onRefresh).toHaveBeenCalledTimes(2);
  expect(opts.showToast).toHaveBeenCalledWith(expect.stringContaining(`編集済みスキップ1件 / 失敗${failed}件`), failed ? 'warning' : 'success');
});
it('keeps generation blocked if masters became unavailable after preview', async () => {
  const opts = options();
  const { result, rerender } = renderHook(() => useShiftMonthOperations(opts));
  await act(async () => { await result.current.handleCalculatePreview(); });
  opts.mastersReady = false; rerender();
  await act(async () => { await result.current.executeGenerate(); });
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(result.current.previewDialogOpen).toBe(true);
});
it('does not refresh or sync when generation fails', async () => {
  mocks.generate.mockResolvedValue(failure);
  const opts = options(); const { result } = renderHook(() => useShiftMonthOperations(opts));
  await act(async () => { await result.current.executeGenerate(); });
  expect(result.current.generating).toBe(false);
  expect(opts.showToast).toHaveBeenCalledWith(failure.error.message, 'error');
  expect(opts.onGenerated).not.toHaveBeenCalled(); expect(opts.onRefresh).not.toHaveBeenCalled();
  expect(opts.runUnsyncedSyncLoop).not.toHaveBeenCalled();
});
describe.each(['unmodified', 'all'] as const)('clear mode %s', mode => {
  it('preserves tenant, live generated shifts, JST month and the modification filter', async () => {
    const q = query([{ id: 'shift-1', title: 'シフト' }]);
    const opts = options(); const { result } = renderHook(() => useShiftMonthOperations(opts));
    act(() => { result.current.openClear(); result.current.setClearMode(mode); });
    await act(async () => { await result.current.executeClearMonthShifts(); });
    expect(q.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(q.is).toHaveBeenCalledWith('deleted_at', null);
    expect(q.not).toHaveBeenCalledWith('pattern_id', 'is', null);
    expect(q.or).toHaveBeenCalledWith('and(start_at.gte.2026-01-31T15:00:00.000Z,start_at.lte.2026-02-28T14:59:59.000Z)');
    if (mode === 'unmodified') expect(q.eq).toHaveBeenCalledWith('is_modified', false);
    else expect(q.eq).not.toHaveBeenCalledWith('is_modified', false);
    expect(mocks.remove).toHaveBeenCalledWith('org-1', ['shift-1']);
    expect(result.current.syncProgress).toBeNull(); expect(result.current.clearDialogOpen).toBe(false);
    expect(opts.onRefresh).toHaveBeenCalledOnce();
    act(() => result.current.openClear()); expect(result.current.clearMode).toBe('unmodified');
  });
});
it('does not delete on closing the clear dialog or when there are no matching rows', async () => {
  const opts = options(); const { result } = renderHook(() => useShiftMonthOperations(opts));
  act(() => { result.current.openClear(); }); act(() => result.current.closeClear());
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  await act(async () => { await result.current.executeClearMonthShifts(); });
  expect(mocks.remove).not.toHaveBeenCalled(); expect(opts.showToast).toHaveBeenCalledWith(expect.stringContaining('消去対象の予定はありません'), 'info');
});
it('deletes in chunks and warns about Google reflection failure', async () => {
  query(Array.from({ length: 21 }, (_, i) => ({ id: `s-${i}`, title: 'シフト' })));
  mocks.remove.mockResolvedValueOnce({ ok: true, data: { deleted: 20, failed: 0 } }).mockResolvedValueOnce({ ok: true, data: { deleted: 1, failed: 1 } });
  const opts = options(); const { result } = renderHook(() => useShiftMonthOperations(opts));
  await act(async () => { await result.current.executeClearMonthShifts(); });
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(mocks.remove.mock.calls[0][1]).toHaveLength(20); expect(mocks.remove.mock.calls[1][1]).toEqual(['s-20']);
  expect(opts.showToast).toHaveBeenCalledWith(expect.stringContaining('21 件を削除しました。1 件はGoogle'), 'warning');
});
it.each(['query', 'action'])('clears progress and shows an error for %s failure', async kind => {
  query([{ id: 's', title: 'シフト' }], kind === 'query' ? new Error('private database detail') : null);
  if (kind === 'action') mocks.remove.mockResolvedValue(failure);
  const opts = options(); const { result } = renderHook(() => useShiftMonthOperations(opts));
  await act(async () => { await result.current.executeClearMonthShifts(); });
  expect(result.current.syncProgress).toBeNull(); expect(result.current.generating).toBe(false);
  expect(opts.onRefresh).not.toHaveBeenCalled(); expect(opts.showToast).toHaveBeenCalledWith(expect.not.stringContaining('private database detail'), 'error');
});
