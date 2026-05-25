// src/app/auth/callback/route.ts
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

  const response = NextResponse.redirect(`${origin}${next}`);
  const isHttp = requestUrl.protocol === 'http:';

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
              secure: isHttp ? false : options.secure,
              path: options.path ?? '/',
              sameSite: options.sameSite ?? 'lax',
            });
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/?error=${error.name}&details=${encodeURIComponent(error.message)}`
    );
  }

  return response;
}