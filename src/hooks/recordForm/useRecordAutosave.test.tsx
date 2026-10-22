// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discardReportAutosave, loadReportAutosave, saveReportAutosave } from '@/app/actions/reports';
import { useRecordAutosave, type RecordAutosaveValues } from './useRecordAutosave';

vi.mock('@/app/actions/reports', () => ({
  loadReportAutosave: vi.fn(),
  saveReportAutosave: vi.fn(),
  discardReportAutosave: vi.fn(),
}));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const values: RecordAutosaveValues = {
  answers: { note: 'draft' }, selectedHelpers: ['Staff'],
  actualStaffs: [{ staff_id: 'staff', staff_role_id: null }], actualServiceTypeId: '',
  startDateTime: '2026-10-22T10:00', endDateTime: '2026-10-22T11:00',
  serviceTime: '1', travelTime: '0', travelExpenses: {},
};
const options = () => ({
  scopeKey: 'user:org:client:report:draft', organizationId: 'org', clientId: 'client',
  reportId: 'report', draftKey: 'draft', loading: false, isDirty: false,
  submitting: false, status: 'draft' as const, values, restore: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(loadReportAutosave).mockReset().mockResolvedValue({ ok: true, data: null });
  vi.mocked(saveReportAutosave).mockReset().mockResolvedValue({ ok: true, data: { saved: true, stale: false, savedAt: null } });
  vi.mocked(discardReportAutosave).mockReset().mockResolvedValue({ ok: true, data: { success: true } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('record autosave lifecycle', () => {
  it('restores only after body loading and continues the saved revision', async () => {
    const saved = deferred<Awaited<ReturnType<typeof loadReportAutosave>>>();
    vi.mocked(loadReportAutosave).mockReturnValue(saved.promise);
    const props = options();
    const { result, rerender } = renderHook(useRecordAutosave, { initialProps: { ...props, loading: true } });
    expect(loadReportAutosave).not.toHaveBeenCalled();
    rerender(props);
    await act(async () => { saved.resolve({ ok: true, data: { payload: values, autosave_revision: 7 } }); });
    expect(props.restore).toHaveBeenCalledWith(values);
    expect(showToast).toHaveBeenCalledWith('入力途中の内容を復元しました', 'info');
    expect(result.current.autosaveState).toBe('saved');
    rerender({ ...props, isDirty: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(saveReportAutosave).toHaveBeenCalledWith(expect.objectContaining({ autosaveRevision: 8, payload: values }));
    expect(loadReportAutosave).toHaveBeenCalledTimes(1);
  });

  it('debounces edits and saves the latest input, rather than a previous render', async () => {
    const props = { ...options(), isDirty: true };
    const { rerender } = renderHook(useRecordAutosave, { initialProps: props });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const updated = { ...values, answers: { note: 'latest edit' } };
    rerender({ ...props, values: updated });
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(saveReportAutosave).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(saveReportAutosave).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org', clientId: 'client', reportId: 'report', draftKey: 'draft',
      autosaveRevision: 1, payload: updated,
    });
  });

  it('cancels queued autosave while a manual save or AI operation is pending', async () => {
    const props = { ...options(), isDirty: true };
    const { rerender } = renderHook(useRecordAutosave, { initialProps: props });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    rerender({ ...props, submitting: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(saveReportAutosave).not.toHaveBeenCalled();
    rerender(props);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(saveReportAutosave).toHaveBeenCalledTimes(1);
  });

  it('never restores or autosaves approved records', async () => {
    renderHook(() => useRecordAutosave({ ...options(), status: 'approved', isDirty: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(loadReportAutosave).not.toHaveBeenCalled();
    expect(saveReportAutosave).not.toHaveBeenCalled();
  });

  it('discards old restoration after a scope switch', async () => {
    const old = deferred<Awaited<ReturnType<typeof loadReportAutosave>>>();
    vi.mocked(loadReportAutosave).mockReturnValueOnce(old.promise);
    const props = options();
    const { rerender } = renderHook(useRecordAutosave, { initialProps: props });
    rerender({ ...props, scopeKey: 'user:org2:client:report:draft2', organizationId: 'org2', draftKey: 'draft2' });
    await act(async () => { old.resolve({ ok: true, data: { payload: values, autosave_revision: 99 } }); });
    expect(loadReportAutosave).toHaveBeenLastCalledWith('org2', 'draft2');
    expect(props.restore).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not let a previous scope save advance the next draft revision', async () => {
    const old = deferred<Awaited<ReturnType<typeof saveReportAutosave>>>();
    vi.mocked(saveReportAutosave).mockReturnValueOnce(old.promise);
    const props = { ...options(), isDirty: true };
    const { rerender } = renderHook(useRecordAutosave, { initialProps: props });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    rerender({ ...props, scopeKey: 'next-scope', draftKey: 'next-draft' });
    await act(async () => {
      old.resolve({ ok: true, data: { saved: true, stale: false, savedAt: null } });
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(saveReportAutosave).toHaveBeenLastCalledWith(expect.objectContaining({ draftKey: 'next-draft', autosaveRevision: 1 }));
  });

  it('keeps a failed autosave visible and permits saving the next edit', async () => {
    vi.mocked(saveReportAutosave).mockResolvedValueOnce({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: '保存できませんでした' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const props = { ...options(), isDirty: true };
      const { result, rerender } = renderHook(useRecordAutosave, { initialProps: props });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.autosaveState).toBe('error');
      rerender({ ...props, values: { ...values, answers: { note: 'retry edit' } } });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.autosaveState).toBe('saved');
      expect(saveReportAutosave).toHaveBeenLastCalledWith(expect.objectContaining({ autosaveRevision: 1 }));
      act(() => { result.current.discardCommittedAutosave(); });
      expect(discardReportAutosave).toHaveBeenCalledWith('org', 'draft');
      expect(result.current.autosaveState).toBe('idle');
    } finally {
      log.mockRestore();
    }
  });

  it('clears the queued save and ignores restoration on unmount', async () => {
    const pending = deferred<Awaited<ReturnType<typeof loadReportAutosave>>>();
    vi.mocked(loadReportAutosave).mockReturnValue(pending.promise);
    const props = { ...options(), isDirty: true };
    const { unmount } = renderHook(useRecordAutosave, { initialProps: props });
    unmount();
    await act(async () => {
      pending.resolve({ ok: true, data: { payload: values, autosave_revision: 1 } });
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(props.restore).not.toHaveBeenCalled();
    expect(saveReportAutosave).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
