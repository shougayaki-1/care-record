import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { recordAuditEvent } from '@/utils/supabase/audit';

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

  // クライアント作成
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // ここでは何もしない（exchangeの結果を見るため）
        },
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

  // 成功したので、実際にCookieをセットするレスポンスを作る
  const response = NextResponse.redirect(`${origin}${next}`);
  
  const supabaseForResponse = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // 本番環境かどうかでSecure属性を調整するロジック（重要）
            // localhost (http) の場合は secure: false にしないと保存されない
            const isLocal = origin.startsWith('http://localhost');
            const finalOptions = {
                ...options,
                secure: !isLocal && options.secure, // ローカルならfalseへ強制
            };

            response.cookies.set(name, value, finalOptions);
          });
        },
      },
    }
  );
  
  // セッション情報をリフレッシュしてCookie書き込みをトリガー
  await supabaseForResponse.auth.setSession(data.session);

  // ログイン成功を監査記録（アクセスの記録）。失敗してもログインは継続する。
  try {
    await recordAuditEvent({
      organizationId: null,
      actorId: data.session.user.id,
      action: 'auth.login',
      resourceType: 'auth',
      outcome: 'success',
      details: { method: 'oauth' },
    });
  } catch (auditError) {
    console.error('failed to record login audit:', auditError);
  }

  return response;
}