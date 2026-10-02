import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { registerSessionActivity } from '@/utils/supabase/auth';
import { completeStepUpReauth } from '@/utils/supabase/stepupReauth';
import { logExternalError } from '@/utils/errors';
import { STEPUP_GRANT_COOKIE, STEPUP_GRANT_COOKIE_TTL_SECONDS, STEPUP_NONCE_COOKIE } from '@/utils/authConstants';
import type { Database } from '@/types/database.generated';
import { safeReauthNext } from '@/utils/reauthTypes';

// 連携済みGoogle/Microsoftアカウントで、重要操作の再認証として
// 再ログインした後に戻ってくるコールバック。src/app/auth/callback/route.ts の通常ログインとは
// 別ルートにして、「再認証グラントの発行」という強い副作用を通常ログインの経路に混ぜない。
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const authError = requestUrl.searchParams.get('error');
  const nonce = requestUrl.searchParams.get('nonce');
  const nextParam = requestUrl.searchParams.get('next') || '/app/settings';
  // オープンリダイレクト防止: 同一オリジン内の絶対パスのみ許可
  const next = safeReauthNext(nextParam);
  const isSecure = requestUrl.protocol === 'https:';

  const failUrl = `${next}${next.includes('?') ? '&' : '?'}stepupError=1`;
  const redirect = (path: string) => new NextResponse(null, { status: 303, headers: {
    Location: path, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } });

  if (authError || !code || !nonce) {
    const failResponse = redirect(failUrl);
    failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
    failResponse.cookies.delete(STEPUP_GRANT_COOKIE);
    return failResponse;
  }

  const nonceCookie = request.cookies.get(STEPUP_NONCE_COOKIE)?.value;
  if (!nonceCookie || nonceCookie !== nonce) {
    console.error('Step-up nonce mismatch');
    const failResponse = redirect(failUrl);
    failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
    failResponse.cookies.delete(STEPUP_GRANT_COOKIE);
    return failResponse;
  }

  // 認証Cookieは実際にブラウザへ返すResponseへ一度だけ書き込む(auth/callbackと同様)。
  const response = redirect(next);
  response.cookies.delete(STEPUP_NONCE_COOKIE);
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, {
              ...options,
              path: options.path || '/',
              sameSite: options.sameSite || 'lax',
              secure: isSecure,
            });
          });
        },
      },
      cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: isSecure,
      },
    }
  );

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) {
      console.error('Step-up auth exchange error:', error?.name);
      const failResponse = redirect(failUrl);
      failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
      failResponse.cookies.delete(STEPUP_GRANT_COOKIE);
      return failResponse;
    }

    const sessionId = await registerSessionActivity(data.session);
    const { token } = await completeStepUpReauth(nonce, data.session.user.id, sessionId);

    response.cookies.set(STEPUP_GRANT_COOKIE, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: STEPUP_GRANT_COOKIE_TTL_SECONDS,
    });

    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
    response.headers.set('Expires', '0');
    response.headers.set('Pragma', 'no-cache');
    return response;
  } catch {
    // completeStepUpReauth が「別アカウントを選んだ」等で拒否した場合もここに来る。
    // exchange後のCookieは成功Responseにだけ反映されるため、失敗時は
    // 選んだ別アカウントのセッションをブラウザに保存しない。
    // Never log OAuth codes, nonce, tokens, or provider error contents.
    logExternalError('auth.reauth-callback', new Error('Step-up verification failed'));
    const failResponse = redirect(failUrl);
    failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
    failResponse.cookies.delete(STEPUP_GRANT_COOKIE);
    return failResponse;
  }
}
