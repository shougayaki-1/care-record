import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/app';
  const origin = requestUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  // Cookieが確実に紐付けられたレスポンスオブジェクトを先に用意
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
            const isLocal = origin.startsWith('http://localhost');
            const finalOptions = {
              ...options,
              secure: !isLocal && options.secure, // ローカル環境ならSecureを強制オフにする
            };
            response.cookies.set(name, value, finalOptions);
          });
        },
      },
    }
  );

  // 認証コードをセッション情報に交換。この時点で上記の setAll が走りCookieがセットされます
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/?error=${error.name}&details=${encodeURIComponent(error.message)}`
    );
  }

  return response;
}