import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { registerSessionActivity } from '@/utils/supabase/auth';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextParam = requestUrl.searchParams.get('next') || '/app';
  // オープンリダイレクト防止: 同一オリジン内の絶対パスのみ許可
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/app';
  const origin = requestUrl.origin;
  const isLocal = origin.startsWith('http://localhost');

  if (!code) {
    console.error('No code provided');
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  // 認証Cookieは、実際にブラウザへ返すResponseへ一度だけ書き込む。
  // cookies().set と response.cookies.set の併用は、チャンクCookieの重複や
  // PKCE verifier/sessionの不整合をブラウザ間で起こし得る。
  const response = NextResponse.redirect(`${origin}${next}`);
  const supabase = createServerClient(
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

  // コード交換実行
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('Auth exchange error:', error.name);
    // 内部エラーメッセージは URL に反射させない（情報露出防止）
    return NextResponse.redirect(`${origin}/?error=auth_exchange_failed`);
  }

  if (!data.session) {
    return NextResponse.redirect(`${origin}/?error=no_session_data`);
  }

  const sessionId = await registerSessionActivity(data.session);

  // ログイン成功を監査記録（アクセスの記録）。失敗してもログインは継続する。
  try {
    await recordAuditEvent({
      organizationId: null,
      actorId: data.session.user.id,
      action: 'auth.login',
      resourceType: 'auth',
      outcome: 'success',
      sessionId,
      details: { method: 'oauth' },
    });
  } catch (auditError) {
    console.error('failed to record login audit:', auditError);
  }

  // 念のためアプリ側でもキャッシュ禁止を保証する。
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  response.headers.set('Expires', '0');
  response.headers.set('Pragma', 'no-cache');
  return response;
}
