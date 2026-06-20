// src/utils/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { decodeJwtSessionId } from '@/utils/jwt';

function authSessionId(accessToken: string): string | null {
    return decodeJwtSessionId(accessToken);
}

export async function updateSession(request: NextRequest, nonce: string, csp: string) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    let response = NextResponse.next({
        request: {
            headers: requestHeaders,
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
                            headers: requestHeaders,
                        },
                    });

                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                    response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
                    response.headers.set('Expires', '0');
                    response.headers.set('Pragma', 'no-cache');
                },
            },
        }
    );

    const { data: { user } } = await supabase.auth.getUser();

    const redirectWithSession = (url: URL) => {
        const redirect = NextResponse.redirect(url);
        response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
        for (const name of ['cache-control', 'expires', 'pragma']) {
            const value = response.headers.get(name);
            if (value) redirect.headers.set(name, value);
        }
        redirect.headers.set('Content-Security-Policy', csp);
        return redirect;
    };

    // 多層防御: 認証が必要なルートは未認証ならトップへリダイレクト
    // （各ページ/サーバアクションでも認可するが、ここで早期に弾く）
    const path = request.nextUrl.pathname;
    const isProtected = path.startsWith('/app') || path.startsWith('/super-admin');
    if (isProtected && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        url.search = `next=${encodeURIComponent(path)}`;
        return redirectWithSession(url);
    }

    // ブラウザが書き換えられるCookieではなく、DB上のセッション活動を検証する。
    if (isProtected && user) {
        const { data: { session } } = await supabase.auth.getSession();
        const sessionId = session?.access_token ? authSessionId(session.access_token) : null;
        const idleCutoff = new Date(Date.now() - 16 * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        // user と sessionId は直前に Auth サーバーで検証済み。
        // システム管理テーブルの存在確認をRLSへ再依存させると、ログイン直後に
        // false negativeとなり idle_timeout へ誤遷移するため、サーバー専用キーで照合する。
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceRoleKey) {
            console.error('[proxy] SUPABASE_SERVICE_ROLE_KEY is not set');
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'error=session_validation_unavailable';
            return redirectWithSession(url);
        }
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });
        const { data: activity, error: activityError } = sessionId
            ? await supabaseAdmin.from('user_session_activity').select('session_hash')
                .eq('auth_session_id', sessionId).eq('user_id', user.id).is('revoked_at', null)
                .gte('last_activity', idleCutoff).gt('absolute_expires_at', now).maybeSingle()
            : { data: null, error: null };
        if (activityError) {
            console.error('[proxy] session activity lookup failed', activityError.message);
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'error=session_validation_unavailable';
            return redirectWithSession(url);
        }
        if (!activity) {
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'reason=idle_timeout';
            return redirectWithSession(url);
        }
    }

    response.headers.set('Content-Security-Policy', csp);
    return response;
}
