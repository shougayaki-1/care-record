'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useRequestGeneration } from './useRequestGeneration';

export function useFetchData<T>(
  fetcher: () => Promise<T>,
  initialData: T,
  enabled: boolean,
  onError?: (msg: string) => void,
  scopeKey?: string,
): { data: T; loading: boolean; refetch: () => Promise<void>; setData: Dispatch<SetStateAction<T>> } {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  const onErrorRef = useRef(onError);
  const initialDataRef = useRef(initialData);
  const { next, invalidate, isCurrent } = useRequestGeneration();

  useEffect(() => {
    fetcherRef.current = fetcher;
    onErrorRef.current = onError;
  }, [fetcher, onError]);

  const fetch = useCallback(async () => {
    const generation = next();
    setLoading(true);
    try {
      const nextData = await fetcherRef.current();
      if (!isCurrent(generation)) return;
      setData(nextData);
    } catch (error) {
      if (!isCurrent(generation)) return;
      onErrorRef.current?.(error instanceof Error ? error.message : 'データの取得に失敗しました');
    } finally {
      if (isCurrent(generation)) setLoading(false);
    }
  }, [isCurrent, next]);

  useEffect(() => {
    // A scope change (organization, client, or target month) must immediately
    // invalidate both in-flight requests and data from the former scope.
    invalidate();
    setData(initialDataRef.current);
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = window.setTimeout(() => void fetch(), 0);
    return () => {
      window.clearTimeout(id);
      invalidate();
    };
  }, [enabled, fetch, invalidate, scopeKey]);

  return { data, loading, refetch: fetch, setData };
}
