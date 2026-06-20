import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { registerSessionActivity } from '@/utils/supabase/auth';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextParam = requestUrl.searchParams.get('next') || '/app';
  // オープンリダイレクト防止: 同一オリジン内の絶対パスのみ許可
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/app';
  const origin = requestUrl.origin;

  if (!code) {
    console.error('No code provided');
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  const cookieStore = await cookies();
  const authCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const isLocal = origin.startsWith('http://localhost');
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const normalizedOptions: CookieOptions = {
              ...options,
              path: options.path || '/',
              sameSite: options.sameSite || 'lax',
              secure: !isLocal,
            };
            authCookies.push({ name, value, options: normalizedOptions });
            cookieStore.set(name, value, normalizedOptions);
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

  // exchange完了後に、実際に返すResponseへSet-Cookieを明示的に付与する。
  const response = NextResponse.redirect(`${origin}${next}`);
  authCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  response.headers.set('Expires', '0');
  response.headers.set('Pragma', 'no-cache');
  return response;
}
