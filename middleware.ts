import { type NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下のパスを除外:
     * - _next/static, _next/image, favicon.ico 等の静的ファイル
     * - /auth/callback (認証処理を行うルートハンドラ) ← ★ここを除外するのが重要
     */
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};