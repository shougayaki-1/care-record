import { type NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';

function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const developmentEval = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  const wasmEval = " 'wasm-unsafe-eval'";
  // Local E2E uses a disposable Supabase stack with a different loopback port.
  // Accept that exact origin only in development; hosted CSP is unchanged.
  let developmentSupabase = '';
  if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const localApi = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
      if (localApi.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(localApi.hostname)) {
        developmentSupabase = ` ${localApi.origin} ${localApi.origin.replace(/^http:/, 'ws:')}`;
      }
    } catch {
      // An invalid URL remains blocked by CSP and fails environment validation.
    }
  }
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${wasmEval}${developmentEval}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' data: https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com${developmentSupabase}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return updateSession(request, nonce, csp);
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|sw.js|workbox-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
