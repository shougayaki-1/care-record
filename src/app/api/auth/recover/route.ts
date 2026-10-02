import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getLogoutStorageKeys, isLogoutStorageKey } from '@/utils/logoutState';
import { runLogoutStep } from '@/utils/logoutStep';
import { STEPUP_GRANT_COOKIE, STEPUP_NONCE_COOKIE } from '@/utils/authConstants';
import { isSameOriginPost } from '@/utils/sameOrigin';

export const dynamic = 'force-dynamic';

function recoveryResponse(completed: boolean): NextResponse {
  const nonce = randomUUID();
  // Only server-owned storage key names are embedded, never session values.
  const keys = JSON.stringify(getLogoutStorageKeys()).replace(/</g, '\\u003c');
  const script = completed ? `<script nonce="${nonce}">
    const keys = ${keys};
    for (const storageName of ['localStorage', 'sessionStorage']) {
      try {
        const storage = window[storageName];
        const names = new Set(keys);
        for (let i = 0; i < storage.length; i++) {
          const name = storage.key(i);
          if (name && keys.some(key => name === key ||
            (name.startsWith(key + '.') && /^\\d+$/.test(name.slice(key.length + 1))))) names.add(name);
        }
        for (const name of names) { try { storage.removeItem(name); } catch {} }
      } catch {}
    }
    // Match the existing ServiceWorkerCleanup policy even if React never started.
    const cleanup = (async () => {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(registrations.map(registration => registration.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.allSettled(names.map(name => caches.delete(name)));
      }
    })();
    Promise.race([cleanup, new Promise(resolve => setTimeout(resolve, 2000))])
      .catch(() => {}).finally(() => window.location.replace('/'));
  </script>` : '';

  return new NextResponse(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CareRecordの復旧</title>
<style nonce="${nonce}">body{font-family:sans-serif;line-height:1.7;margin:4rem auto;padding:1.5rem;max-width:36rem;color:CanvasText;background:Canvas}button{font:inherit;padding:.7rem 1rem;cursor:pointer}a{color:LinkText}</style>
</head><body><main>
<h1>${completed ? 'ログアウトしました' : 'CareRecordの復旧'}</h1>
${completed ? '<p>ログイン画面へ戻ります。</p><p><a href="/">ログイン画面へ戻る</a></p>' :
  '<p>画面が表示されない場合や別のアカウントで入り直す場合は、ログアウトしてやり直してください。</p><form action="/api/auth/recover" method="post"><button type="submit">ログアウトしてやり直す</button></form>'}
</main>${script}</body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Native forms need a non-null Origin for the POST CSRF check.
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

/** A plain HTML form, independent of Next/React bundles, providers and auth lookup. */
export function GET(): NextResponse {
  return recoveryResponse(false);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Native same-origin forms send Origin. Reject cross-site logout/CSRF.
  if (!isSameOriginPost(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const response = recoveryResponse(true);
  await runLogoutStep(async () => {
    // Missing service-role configuration or bookkeeping failures cannot break recovery.
    const { recordLogout } = await import('@/app/actions/auth');
    await recordLogout();
  }, 'recovery logout bookkeeping failed');

  await runLogoutStep(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: values => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    });
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) throw error;
  }, 'recovery supabase signOut failed');

  const authKeys = getLogoutStorageKeys().filter(key => key !== 'care-record-sidebar-open');
  const cookieNames = new Set([...authKeys, STEPUP_NONCE_COOKIE, STEPUP_GRANT_COOKIE, 'g_oauth_state']);
  for (const { name } of [...request.cookies.getAll(), ...response.cookies.getAll()]) {
    if (isLogoutStorageKey(name, authKeys)) cookieNames.add(name);
  }
  for (const name of cookieNames) {
    response.cookies.set(name, '', { path: '/', maxAge: 0, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:' });
  }
  return response;
}
