import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/utils/log';
import { isSameOriginPost } from '@/utils/sameOrigin';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginPost(request)) {
    return new NextResponse(null, { status: 403 });
  }
  try {
    const text = await request.text();
    if (text.length > 1024) return new NextResponse(null, { status: 413 });
    const { boundary, kind, digest } = JSON.parse(text);
    if (!['segment', 'global'].includes(boundary) || !['chunk', 'hydration', 'runtime'].includes(kind) ||
        (digest !== undefined && (typeof digest !== 'string' || !/^[\w-]{1,64}$/.test(digest)))) {
      return new NextResponse(null, { status: 400 });
    }
    logError('Client rendering failed', { context: 'recovery', boundary, kind, digest });
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
