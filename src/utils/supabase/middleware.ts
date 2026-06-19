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

    // 多層防御(アイドルタイムアウト): クライアントの IdleTimeout が実際の signOut を行うが、
    // 万一クライアントが動作しない場合に備え、最終アクティビティが著しく古ければ保護ルートを弾く。
    // 閾値はクライアント側(15分 + 猶予)より少し長めに取り、正常操作を誤って遮断しない。
    if (isProtected && user) {
        const IDLE_LIMIT_MS = 16 * 60 * 1000;
        const lastActivity = Number(request.cookies.get('cr_last_activity')?.value);
        if (lastActivity && Date.now() - lastActivity > IDLE_LIMIT_MS) {
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'reason=idle_timeout';
            const redirect = NextResponse.redirect(url);
            redirect.cookies.delete('cr_last_activity');
            return redirect;
        }
    }

    return response;
}