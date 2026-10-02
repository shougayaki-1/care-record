// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecordQuery } from './useRecordQuery';
import { commitRecordChange } from '@/utils/recordFeedUpdates';
const empty: string[] = [];
const ignoreError = () => {};
const deferred = () => { let resolve!: (value: string[]) => void; const promise = new Promise<string[]>((done) => { resolve = done; }); return { promise, resolve }; };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('record snapshot query', () => {
  it('survives StrictMode and refreshes committed records without appending duplicates', async () => {
    let database = ['normal'];
    const load = vi.fn(async () => [...database]);
    const { result } = renderHook(() => useRecordQuery({ organizationId: 'org-1', queryKey: '', load, empty, onError: ignoreError }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.data).toEqual(['normal']));
    for (const record of ['internal', 'AI']) {
      await act(async () => { await commitRecordChange('org-1', async () => { database = [...database, record]; }); });
      expect(result.current.data).toEqual(database);
    }
    await act(async () => { await commitRecordChange('org-1', async () => {}); });
    expect(result.current.data).toEqual(['normal', 'internal', 'AI']);
  });
  it('ignores an older request after a later refresh has completed', async () => {
    const old = deferred(); const latest = deferred();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useRecordQuery({ organizationId: 'org-1', queryKey: '', load, empty, onError: ignoreError }));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await act(async () => { latest.resolve(['latest']); await refresh; });
    await act(async () => { old.resolve(['stale']); });
    expect(result.current.data).toEqual(['latest']);
  });
  it('hides old workspace data and ignores its in-flight response', async () => {
    const old = deferred(); const fresh = deferred();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { result, rerender } = renderHook(({ org }) => useRecordQuery({ organizationId: org, queryKey: '', load, empty, onError: ignoreError }), { initialProps: { org: 'org-1' } });
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    rerender({ org: 'org-2' });
    expect(result.current.data).toEqual([]);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => { fresh.resolve(['org-2']); old.resolve(['org-1']); });
    expect(result.current.data).toEqual(['org-2']);
  });
  it('clears removed records and releases loading after failed refetch', async () => {
    const onError = vi.fn(); const load = vi.fn().mockResolvedValueOnce(['removed']).mockRejectedValueOnce(new Error('read failure'));
    const { result } = renderHook(() => useRecordQuery({ organizationId: 'org-1', queryKey: '', load, empty, onError }));
    await waitFor(() => expect(result.current.data).toEqual(['removed']));
    await act(async () => { await commitRecordChange('org-1', async () => 'saved'); });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
  });
  it('refreshes visible external submissions on the shared polling interval', async () => {
    vi.useFakeTimers(); const load = vi.fn().mockResolvedValue([]);
    renderHook(() => useRecordQuery({ organizationId: 'org-1', queryKey: '', load, empty, onError: ignoreError, refreshInterval: 30000 }));
    await act(async () => { await Promise.resolve(); });
    expect(load).toHaveBeenCalledOnce();
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
