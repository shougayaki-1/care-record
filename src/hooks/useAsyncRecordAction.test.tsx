// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAsyncRecordAction } from './useAsyncRecordAction';
const { showToast, dismissToast } = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast, dismissToast }) }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }
const options = { successMessage: '保存しました', errorMessage: '入力を保持して再試行できます' };
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe('record action lifecycle', () => {
  it('locks before confirmation and the first render, including StrictMode', async () => {
    const confirmation = deferred<boolean>(); const response = deferred<number>();
    const operation = vi.fn(() => response.promise); const confirm = vi.fn(() => confirmation.promise);
    const { result } = renderHook(() => useAsyncRecordAction(), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
    let first!: ReturnType<typeof result.current.run>;
    await act(async () => { first = result.current.run(operation, { ...options, confirm }); expect(await result.current.run(operation, options)).toEqual({ ok: false, reason: 'busy' }); });
    expect(confirm).toHaveBeenCalledOnce(); expect(operation).not.toHaveBeenCalled(); expect(result.current.pending).toBe(true);
    await act(async () => { confirmation.resolve(true); await confirmation.promise; });
    expect(operation).toHaveBeenCalledOnce();
    await act(async () => { response.resolve(42); expect(await first).toEqual({ ok: true, value: 42 }); });
    expect(result.current.pending).toBe(false); expect(showToast).toHaveBeenCalledWith('保存しました', 'success');
  });
  it('clears error and previous notification on retry, and releases the lock after failure or cancellation', async () => {
    const { result } = renderHook(() => useAsyncRecordAction());
    await act(async () => { await result.current.run(async () => { throw new Error('private detail'); }, options); });
    expect(result.current.pending).toBe(false); expect(result.current.error).toBe(options.errorMessage);
    expect(showToast).toHaveBeenLastCalledWith(options.errorMessage, 'error');
    const response = deferred<void>(); let retry!: ReturnType<typeof result.current.run>;
    act(() => { retry = result.current.run(() => response.promise, options); });
    expect(result.current.error).toBeNull(); expect(result.current.pending).toBe(true); expect(dismissToast).toHaveBeenCalledTimes(2);
    await act(async () => { response.resolve(); await retry; });
    expect(showToast).toHaveBeenLastCalledWith('保存しました', 'success');
    const operation = vi.fn();
    await act(async () => { await result.current.run(operation, { ...options, confirm: async () => false }); });
    expect(operation).not.toHaveBeenCalled(); expect(result.current.pending).toBe(false); expect(result.current.error).toBeNull();
    expect(dismissToast).toHaveBeenCalledTimes(3);
  });
  it('ignores completion after a scope change or unmount', async () => {
    const first = deferred<void>();
    const { result, rerender, unmount } = renderHook(({ scope }) => useAsyncRecordAction(scope), { initialProps: { scope: 'org-a' } });
    let run!: ReturnType<typeof result.current.run>; let isCurrent!: () => boolean;
    act(() => { run = result.current.run((current) => { isCurrent = current; return first.promise; }, options); });
    rerender({ scope: 'org-b' }); expect(isCurrent()).toBe(false);
    rerender({ scope: 'org-a' }); expect(isCurrent()).toBe(false);
    await act(async () => { first.resolve(); expect(await run).toEqual({ ok: false, reason: 'cancelled' }); });
    expect(showToast).not.toHaveBeenCalled(); expect(result.current.pending).toBe(false);
    const second = deferred<void>(); act(() => { run = result.current.run(() => second.promise, options); });
    unmount(); second.resolve(); await run; expect(showToast).not.toHaveBeenCalled();
  });
  it('reuses an idempotency key only for an unchanged failed attempt', () => {
    const { result } = renderHook(() => useAsyncRecordAction());
    const key = result.current.attemptKey('row', { value: 'one' });
    expect(result.current.attemptKey('row', { value: 'one' })).toBe(key);
    expect(result.current.attemptKey('row', { value: 'two' })).not.toBe(key);
    const changed = result.current.attemptKey('row', { value: 'two' });
    result.current.finishAttempt('row'); expect(result.current.attemptKey('row', { value: 'two' })).not.toBe(changed);
  });
  it('does not show an old error in a different record scope', async () => {
    const { result, rerender } = renderHook(({ scope }) => useAsyncRecordAction(scope), { initialProps: { scope: 'record-a' } });
    await act(async () => { await result.current.run(async () => { throw new Error('failed'); }, options); });
    expect(result.current.error).toBe(options.errorMessage);
    rerender({ scope: 'record-b' }); expect(result.current.error).toBeNull();
  });

});
