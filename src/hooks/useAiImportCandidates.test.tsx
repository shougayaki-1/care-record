// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let org = '';
  const builder = { select: () => builder, eq: (_: string, value: string) => { org = value; return builder; }, is: () => builder, order: () => query(table, org) };
  return builder;
} } }));
import { useAiImportCandidates } from './useAiImportCandidates';
function deferred() {
  let resolve!: (value: { data: { id: string; name: string }[] | null; error: unknown }) => void;
  const promise = new Promise<Parameters<typeof resolve>[0]>((done) => { resolve = done; });
  return { promise, resolve };
}
const success = (id: string) => ({ data: [{ id, name: id }], error: null });
afterEach(cleanup);
beforeEach(() => { query.mockReset(); });
describe('useAiImportCandidates', () => {
  it.each(['clients', 'staffs'])('waits for %s and never publishes partial candidates', async (table) => {
    const slow = deferred();
    query.mockImplementation((name: string) => name === table ? slow.promise : Promise.resolve(success('partial')));
    const { result } = renderHook(() => useAiImportCandidates('org-a'));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(result.current.status).toBe('loading');
    expect(result.current.clients).toEqual([]); expect(result.current.helpers).toEqual([]);
    await act(async () => slow.resolve({ data: null, error: { message: 'private diagnostic' } }));
    expect(result.current.status).toBe('error');
    expect(result.current.clients).toEqual([]); expect(result.current.helpers).toEqual([]);
  });
  it('catches rejected requests and missing data, but accepts two empty successful lists', async () => {
    query.mockRejectedValueOnce(new Error('transport')).mockResolvedValue(success('unused'));
    const { result } = renderHook(() => useAiImportCandidates('org-a'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    query.mockResolvedValue({ data: null, error: null });
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe('error');
    query.mockResolvedValue({ data: [], error: null });
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe('success');
    expect(result.current.clients).toEqual([]); expect(result.current.helpers).toEqual([]);
  });
  it('drops older retries that finish after the latest success', async () => {
    const old = deferred(); query.mockReturnValue(old.promise);
    const { result } = renderHook(() => useAiImportCandidates('org-a'));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    query.mockResolvedValue(success('new'));
    await act(async () => { await result.current.retry(); });
    await act(async () => old.resolve({ data: null, error: { message: 'old failure' } }));
    expect(result.current.status).toBe('success');
    expect(result.current.clients).toEqual(success('new').data);
  });
  it('discards old scope responses including A → B → A and clears candidates without an organization', async () => {
    const old = deferred(); query.mockReturnValue(old.promise);
    const { result, rerender } = renderHook(({ org }: { org: string | undefined }) => useAiImportCandidates(org), { initialProps: { org: 'org-a' as string | undefined } });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    query.mockResolvedValue(success('org-b')); rerender({ org: 'org-b' });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.clients).toEqual(success('org-b').data);
    const fresh = deferred(); query.mockReturnValue(fresh.promise); rerender({ org: 'org-a' });
    expect(result.current.status).toBe('loading'); expect(result.current.clients).toEqual([]);
    await waitFor(() => expect(query).toHaveBeenCalledTimes(6));
    await act(async () => old.resolve(success('old-org-a')));
    expect(result.current.status).toBe('loading');
    await act(async () => fresh.resolve(success('fresh-org-a')));
    expect(result.current.clients).toEqual(success('fresh-org-a').data);
    rerender({ org: undefined });
    expect(result.current.clients).toEqual([]); expect(result.current.status).toBe('loading');
    expect(query).toHaveBeenCalledWith('clients', 'org-b');
    expect(query).toHaveBeenCalledWith('staffs', 'org-a');
  });
  it('ignores StrictMode cleanup responses and completions after unmount', async () => {
    const old = deferred(); const current = deferred();
    let calls = 0;
    query.mockImplementation(() => ++calls <= 2 ? old.promise : current.promise);
    const { result, unmount } = renderHook(() => useAiImportCandidates('org-a'), { reactStrictMode: true });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    let pending!: Promise<void>;
    act(() => { pending = result.current.retry(); });
    await act(async () => old.resolve(success('ignored')));
    expect(result.current.status).toBe('loading');
    const before = result.current;
    unmount();
    await act(async () => { current.resolve(success('unmounted')); await pending; });
    expect(result.current).toBe(before);
  });
});
