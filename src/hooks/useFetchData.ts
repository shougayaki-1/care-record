'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getActionErrorMessage } from '@/utils/actionResult';
import { useRequestGeneration } from './useRequestGeneration';

export function useFetchData<T>(
  fetcher: () => Promise<T>,
  initialData: T,
  enabled: boolean,
  onError?: (msg: string) => void,
  scopeKey?: string,
): { data: T; error: unknown; loading: boolean; refetch: () => Promise<void>; setData: Dispatch<SetStateAction<T>> } {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
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
    setError(null);
    try {
      const nextData = await fetcherRef.current();
      if (!isCurrent(generation)) return;
      setData(nextData);
    } catch (error) {
      if (!isCurrent(generation)) return;
      setError(error);
      onErrorRef.current?.(getActionErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      if (isCurrent(generation)) setLoading(false);
    }
  }, [isCurrent, next]);

  useEffect(() => {
    // A scope change (organization, client, or target month) must immediately
    // invalidate both in-flight requests and data from the former scope.
    invalidate();
    setData(initialDataRef.current);
    setError(null);
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

  return { data, error, loading, refetch: fetch, setData };
}
