// src/utils/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function authSessionId(accessToken: string): string | null {
    try {
        const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { session_id?: string };
        return payload.session_id || null;
    } catch {
        return null;
    }
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
        const { data: activity } = sessionId
            ? await supabase.from('user_session_activity').select('session_hash')
                .eq('auth_session_id', sessionId).eq('user_id', user.id).is('revoked_at', null)
                .gte('last_activity', idleCutoff).gt('absolute_expires_at', now).maybeSingle()
            : { data: null };
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
