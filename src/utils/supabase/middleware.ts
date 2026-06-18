// src/utils/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-supabase-url.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-supabase-anon-key';

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value),
                    );

                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    });

                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                },
            },
        }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // 多層防御: 認証が必要なルートは未認証ならトップへリダイレクト
    // （各ページ/サーバアクションでも認可するが、ここで早期に弾く）
    const path = request.nextUrl.pathname;
    const isProtected = path.startsWith('/app') || path.startsWith('/super-admin');
    if (isProtected && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        url.search = `next=${encodeURIComponent(path)}`;
        return NextResponse.redirect(url);
    }

    return response;
}