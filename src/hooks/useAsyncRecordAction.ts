'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/ToastProvider';

type Severity = 'success' | 'warning' | 'error' | 'info';
type Options<T> = {
  confirm?: () => Promise<boolean>;
  successMessage?: string | ((value: T) => string | null);
  successSeverity?: Severity | ((value: T) => Severity);
  errorMessage: string | ((error: unknown) => string);
};
type Outcome<T> = { ok: true; value: T } | { ok: false; reason: 'busy' | 'cancelled' | 'error' };

/** UI lifecycle only. Persistence/refetch stays in #34's commitRecordChange. */
export function useAsyncRecordAction(scope = '') {
  const { showToast, dismissToast } = useToast();
  const locked = useRef(false);
  const mounted = useRef(true);
  const activeScope = useRef(scope);
  const attempts = useRef(new Map<string, { fingerprint: string; key: string }>());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    activeScope.current = scope;
    return () => { mounted.current = false; };
  }, [scope]);
  const isRunning = useCallback(() => locked.current, []);
  const clearError = useCallback(() => setError(null), []);
  const attemptKey = useCallback((id: string, payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    const previous = attempts.current.get(id);
    if (previous?.fingerprint === fingerprint) return previous.key;
    const key = crypto.randomUUID();
    attempts.current.set(id, { fingerprint, key });
    return key;
  }, []);
  const finishAttempt = useCallback((id: string) => { attempts.current.delete(id); }, []);
  const run = useCallback(async <T,>(operation: (isCurrent: () => boolean) => Promise<T>, options: Options<T>): Promise<Outcome<T>> => {
    // Lock before the first await, including a confirmation dialog.
    if (locked.current) return { ok: false, reason: 'busy' };
    if (!mounted.current) return { ok: false, reason: 'cancelled' };
    const requestScope = scope;
    const isCurrent = () => mounted.current && activeScope.current === requestScope;
    locked.current = true;
    setPending(true);
    setError(null);
    dismissToast?.();
    try {
      if (options.confirm && !await options.confirm()) return { ok: false, reason: 'cancelled' };
      if (!isCurrent()) return { ok: false, reason: 'cancelled' };
      const value = await operation(isCurrent);
      if (!isCurrent()) return { ok: false, reason: 'cancelled' };
      const message = typeof options.successMessage === 'function' ? options.successMessage(value) : options.successMessage;
      const severity = typeof options.successSeverity === 'function' ? options.successSeverity(value) : options.successSeverity ?? 'success';
      if (mounted.current && message) showToast(message, severity);
      return { ok: true, value };
    } catch (cause) {
      const message = typeof options.errorMessage === 'function' ? options.errorMessage(cause) : options.errorMessage;
      if (isCurrent()) {
        setError(message);
        showToast(message, 'error');
      }
      return { ok: false, reason: 'error' };
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }, [dismissToast, scope, showToast]);
  return { pending, error, run, isRunning, clearError, attemptKey, finishAttempt };
}
