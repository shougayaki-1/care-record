'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeRecordFeed } from '@/utils/recordFeedUpdates';

/** Replace authoritative snapshots; ignore responses from old filters/workspaces.
 * Keep load/onError callbacks and the empty value stable between renders.
 */
export function useRecordQuery<T>({ organizationId, queryKey, load, empty, onError, refreshInterval }: {
  organizationId?: string;
  queryKey: string;
  load: () => Promise<T>;
  empty: T;
  onError: (error: unknown) => void;
  refreshInterval?: number;
}) {
  const key = `${organizationId ?? ''}:${queryKey}`;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data: T; loading: boolean; error: unknown }>({ key: '', data: empty, loading: true, error: null });
  const refresh = useCallback(async () => {
    if (!organizationId) return;
    const request = ++generation.current;
    setSnapshot((previous) => ({ key, data: previous.key === key ? previous.data : empty, loading: true, error: null }));
    try {
      const data = await load();
      if (request === generation.current) setSnapshot({ key, data, loading: false, error: null });
    } catch (error) {
      if (request === generation.current) {
        setSnapshot({ key, data: empty, loading: false, error });
        onError(error);
      }
    }
  }, [organizationId, key, empty, load, onError]);

  const cancel = useCallback(() => { ++generation.current; }, []);

  useEffect(() => {
    if (!organizationId) return;
    const unsubscribe = subscribeRecordFeed(organizationId, refresh);
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = refreshInterval ? window.setInterval(refreshVisible, refreshInterval) : undefined;
    return () => {
      active = false;
      cancel();
      unsubscribe();
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [organizationId, refresh, refreshInterval, cancel]);

  return { error: snapshot.key === key ? snapshot.error : null, data: snapshot.key === key ? snapshot.data : empty, loading: !organizationId || snapshot.key !== key || snapshot.loading, refresh };
}
