import { type NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';

function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const developmentEval = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  const wasmEval = " 'wasm-unsafe-eval'";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${wasmEval}${developmentEval}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' data: https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com",
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
