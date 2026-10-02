'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getReauthMethods, startProviderReauth, verifyReauthPassword } from '@/app/actions/authSecurity';
import { ReauthDialog } from '@/components/auth/ReauthDialog';
import { safeReauthNext, type ReauthMethod, type ReauthPurpose } from '@/utils/reauthTypes';

type Grant = { token: string };
type Options = {
  next: string; preferredMethod?: ReauthMethod;
  // Calendar authorization already verifies the linked Google subject. Using
  // that existing route avoids two consecutive Google authorization screens.
  calendarAuthorization?: () => Promise<string>;
};
type Pending = { purpose: ReauthPurpose; options: Options; resolve: (value: Grant | null) => void };

export function useReauth() {
  const pending = useRef<Pending | null>(null);
  const activeAttempt = useRef<symbol | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [methods, setMethods] = useState<ReauthMethod[]>([]);
  const [method, setMethod] = useState<ReauthMethod>('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = useCallback((grant: Grant | null) => {
    pending.current?.resolve(grant);
    pending.current = null;
    activeAttempt.current = null;
    setOpen(false);
    setLoading(false);
  }, []);
  useEffect(() => () => { pending.current?.resolve(null); pending.current = null; }, []);

  const requestReauth = useCallback((purpose: ReauthPurpose, options: Options): Promise<Grant | null> => {
    pending.current?.resolve(null);
    setOpen(true); setLoading(true); setError(null); setMethods([]);
    setDialogKey(value => value + 1);
    return new Promise(resolve => {
      const request = { purpose, options, resolve };
      pending.current = request;
      let loadFinished = false;
      const loadTimer = setTimeout(() => {
        loadFinished = true;
        if (pending.current === request) {
          setLoading(false); setError('再認証方法の確認がタイムアウトしました。キャンセルして再度お試しください');
        }
      }, 30_000);
      void getReauthMethods().then(available => {
        if (pending.current !== request || loadFinished) return;
        setMethods(available);
        setMethod(available.includes(options.preferredMethod || 'password') ? options.preferredMethod || 'password' : available[0] || 'password');
        if (!available.length) setError('利用できる再認証方法がありません');
      }).catch(() => {
        if (pending.current === request && !loadFinished) setError('再認証方法を確認できません。キャンセルして再度お試しください');
      }).finally(() => { clearTimeout(loadTimer); if (pending.current === request) setLoading(false); });
    });
  }, []);

  const submit = async (password: string) => {
    const request = pending.current;
    if (!request || loading) return;
    const attempt = Symbol();
    activeAttempt.current = attempt;
    const isActive = () => pending.current === request && activeAttempt.current === attempt;
    setLoading(true); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          if (method === 'password') {
            const grant = await verifyReauthPassword(request.purpose, password);
            if (isActive()) finish(grant);
            return;
          }
          if (method === 'google' && request.options.calendarAuthorization) {
            const url = await request.options.calendarAuthorization();
            if (isActive()) { finish(null); window.location.assign(url); }
            return;
          }
          const { nonce, provider } = await startProviderReauth(request.purpose, method);
          if (!isActive()) return;
          const next = safeReauthNext(request.options.next);
          const redirectTo = `${window.location.origin}/auth/reauth-callback?nonce=${encodeURIComponent(nonce)}&next=${encodeURIComponent(next)}`;
          const { data, error: oauthError } = await supabase.auth.signInWithOAuth({ provider, options: {
            redirectTo, skipBrowserRedirect: true,
            ...(provider === 'azure' ? { scopes: 'email' } : {}),
            queryParams: provider === 'azure' ? { prompt: 'login' } : { prompt: 'select_account', max_age: '0' },
          } });
          if (oauthError || !data.url) throw new Error('再認証を開始できません');
          if (isActive()) { finish(null); window.location.assign(data.url); }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('再認証がタイムアウトしました。もう一度お試しください')), 30_000); }),
      ]);
    } catch (cause) {
      if (isActive()) {
        // Invalidate late responses after timeout/cancel before they can resume
        // an operation. A retry creates a new request identity.
        activeAttempt.current = null;
        setError(cause instanceof Error ? cause.message : '再認証に失敗しました');
      }
    } finally { clearTimeout(timer); if (pending.current === request) setLoading(false); }
  };

  return { requestReauth, reauthDialog: open ? <ReauthDialog key={dialogKey} methods={methods} method={method} loading={loading}
    error={error} onMethodChange={setMethod} onSubmit={submit} onCancel={() => finish(null)} /> : null };
}
