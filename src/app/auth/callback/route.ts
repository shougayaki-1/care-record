import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/app';
  const origin = requestUrl.origin;

  console.log('--- Auth Callback Start ---');
  console.log('Code present:', !!code);
  console.log('Origin:', origin);

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
          const cookies = request.cookies.getAll();
          // console.log('Current Cookies:', cookies.map(c => c.name)); // 必要ならコメントアウト解除
          return cookies;
        },
        setAll(cookiesToSet) {
          // ここでは何もしない（exchangeの結果を見るため）
          console.log('Supabase requested to set cookies:', cookiesToSet.map(c => `${c.name} (secure: ${c.options?.secure})`));
        },
      },
    }
  );

  // コード交換実行
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('!!! Exchange Error !!!', error);
    return NextResponse.redirect(`${origin}/?error=${error.name}&details=${error.message}`);
  }

  if (!data.session) {
    console.error('!!! No session in data !!!');
    return NextResponse.redirect(`${origin}/?error=no_session_data`);
  }

  console.log('Session exchanged successfully.');
  console.log('User ID:', data.session.user.id);

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
            
            console.log(`Setting Cookie: ${name}, Secure: ${finalOptions.secure}, Path: ${finalOptions.path}`);
            response.cookies.set(name, value, finalOptions);
          });
        },
      },
    }
  );
  
  // セッション情報をリフレッシュしてCookie書き込みをトリガー
  await supabaseForResponse.auth.setSession(data.session);

  console.log('--- Auth Callback End ---');
  return response;
}