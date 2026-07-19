// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFetchData } from './useFetchData';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useFetchData', () => {
  it('does not let an older request overwrite a newer refetch result', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const fetchFirst = vi.fn(() => first.promise);
    const fetchSecond = vi.fn(() => second.promise);

    const { result, rerender } = renderHook(
      ({ fetcher }) => useFetchData(fetcher, [] as string[], true),
      { initialProps: { fetcher: fetchFirst } },
    );

    await waitFor(() => expect(fetchFirst).toHaveBeenCalledTimes(1));

    rerender({ fetcher: fetchSecond });
    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => expect(fetchSecond).toHaveBeenCalledTimes(1));

    await act(async () => {
      second.resolve(['new organization']);
      await second.promise;
    });
    expect(result.current.data).toEqual(['new organization']);

    await act(async () => {
      first.resolve(['old organization']);
      await first.promise;
    });
    expect(result.current.data).toEqual(['new organization']);
  });

  it('clears former-scope data and fetches again when the scope changes', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      ({ scopeKey }) => useFetchData(fetcher, [] as string[], true, undefined, scopeKey),
      { initialProps: { scopeKey: 'organization-a' } },
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve(['organization-a']);
      await first.promise;
    });
    expect(result.current.data).toEqual(['organization-a']);

    rerender({ scopeKey: 'organization-b' });
    expect(result.current.data).toEqual([]);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(['organization-b']);
      await second.promise;
    });
    expect(result.current.data).toEqual(['organization-b']);
  });
});
