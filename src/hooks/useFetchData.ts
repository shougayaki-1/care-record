'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export function useFetchData<T>(
  fetcher: () => Promise<T>,
  initialData: T,
  enabled: boolean,
  onError?: (msg: string) => void,
): { data: T; loading: boolean; refetch: () => Promise<void>; setData: Dispatch<SetStateAction<T>> } {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    fetcherRef.current = fetcher;
    onErrorRef.current = onError;
  }, [fetcher, onError]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcherRef.current());
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => void fetch(), 0);
    return () => window.clearTimeout(id);
  }, [enabled, fetch]);

  return { data, loading, refetch: fetch, setData };
}
