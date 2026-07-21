import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { registerSessionActivity } from '@/utils/supabase/auth';
import { completeStepUpReauth } from '@/utils/supabase/stepupReauth';
import { logExternalError } from '@/utils/errors';
import { STEPUP_GRANT_COOKIE, STEPUP_GRANT_COOKIE_TTL_SECONDS, STEPUP_NONCE_COOKIE } from '@/utils/authConstants';
import type { Database } from '@/types/database.generated';

// パスワードを持たない(SSOのみの)アカウントが、重要操作の再認証としてGoogle/Microsoftへ
// 再ログインした後に戻ってくるコールバック。src/app/auth/callback/route.ts の通常ログインとは
// 別ルートにして、「再認証グラントの発行」という強い副作用を通常ログインの経路に混ぜない。
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const authError = requestUrl.searchParams.get('error');
  const nonce = requestUrl.searchParams.get('nonce');
  const nextParam = requestUrl.searchParams.get('next') || '/app/settings';
  // オープンリダイレクト防止: 同一オリジン内の絶対パスのみ許可
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/app/settings';
  const origin = requestUrl.origin;
  const isLocal = origin.startsWith('http://localhost');

  const failUrl = `${origin}${next}${next.includes('?') ? '&' : '?'}stepupError=1`;

  if (authError || !code || !nonce) {
    if (authError) console.error('Step-up OAuth error:', authError);
    const failResponse = NextResponse.redirect(failUrl);
    failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
    return failResponse;
  }

  const nonceCookie = request.cookies.get(STEPUP_NONCE_COOKIE)?.value;
  if (!nonceCookie || nonceCookie !== nonce) {
    console.error('Step-up nonce mismatch');
    const failResponse = NextResponse.redirect(failUrl);
    failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
    return failResponse;
  }

  // 認証Cookieは実際にブラウザへ返すResponseへ一度だけ書き込む(auth/callbackと同様)。
  const response = NextResponse.redirect(`${origin}${next}`);
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
              secure: !isLocal,
            });
          });
        },
      },
      cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: !isLocal,
      },
    }
  );

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) {
      console.error('Step-up auth exchange error:', error?.name);
      const failResponse = NextResponse.redirect(failUrl);
      failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
      return failResponse;
    }

    const sessionId = await registerSessionActivity(data.session);
    const { token } = await completeStepUpReauth(nonce, data.session.user.id, sessionId);

    response.cookies.set(STEPUP_GRANT_COOKIE, token, {
      httpOnly: true,
      secure: !isLocal,
      sameSite: 'lax',
      path: '/',
      maxAge: STEPUP_GRANT_COOKIE_TTL_SECONDS,
    });

    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
    response.headers.set('Expires', '0');
    response.headers.set('Pragma', 'no-cache');
    return response;
  } catch (err) {
    // completeStepUpReauth が「別アカウントを選んだ」等で拒否した場合もここに来る。
    // セッション自体はexchangeCodeForSessionで既に切り替わっているため、
    // 再認証グラントを発行せずエラー遷移するだけに留める。
    logExternalError('auth.reauth-callback', err);
    const failResponse = NextResponse.redirect(failUrl);
    failResponse.cookies.delete(STEPUP_NONCE_COOKIE);
    return failResponse;
  }
}
