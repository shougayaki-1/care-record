import type { NextRequest } from 'next/server';

export function isSameOriginPost(request: NextRequest): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    const source = new URL(origin);
    // NextURL normalizes 127.0.0.1 to localhost. Host preserves the actual origin.
    const host = request.headers.get('host') ?? request.nextUrl.host;
    return source.origin === origin && source.host === host && source.protocol === request.nextUrl.protocol;
  } catch {
    return false;
  }
}
