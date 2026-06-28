// src/utils/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { decodeJwtPayload, decodeJwtSessionId } from '@/utils/jwt';

type MiddlewareDatabase = {
    public: {
        Tables: {
            user_session_activity: {
                Row: { session_hash: string };
                Insert: {
                    session_hash: string;
                    auth_session_id: string;
                    user_id: string;
                    last_activity: string;
                    absolute_expires_at: string;
                    revoked_at: string | null;
                };
                Update: {
                    session_hash?: string;
                    auth_session_id?: string;
                    user_id?: string;
                    last_activity?: string;
                    absolute_expires_at?: string;
                    revoked_at?: string | null;
                };
                Relationships: [];
            };
        };
        Views: Record<string, never>;
        Functions: Record<string, never>;
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
};

type SupabaseAdminClient = ReturnType<typeof createClient<MiddlewareDatabase, 'public'>>;

let supabaseAdmin: SupabaseAdminClient | null = null;

function getSupabaseAdmin(supabaseUrl: string, serviceRoleKey: string): SupabaseAdminClient {
    if (!supabaseAdmin) {
        supabaseAdmin = createClient<MiddlewareDatabase, 'public'>(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });
    }
    return supabaseAdmin;
}

function authSessionId(accessToken: string): string | null {
    return decodeJwtSessionId(accessToken);
}

async function hashAccessToken(accessToken: string): Promise<string> {
    const bytes = new TextEncoder().encode(accessToken);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isFreshJwt(accessToken: string): boolean {
    const iat = decodeJwtPayload(accessToken)?.iat;
    if (typeof iat !== 'number') return false;
    return Date.now() - iat * 1000 <= 5 * 60 * 1000;
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
        const supabaseAdmin = getSupabaseAdmin(supabaseUrl, serviceRoleKey);
        if (!sessionId) {
            // JWT に session_id フィールドがない（古いトークン形式 or JWT テンプレートの設定問題）。
            // idle_timeout にリダイレクトすると page.tsx が signOut() を呼び出し新規セッションを
            // 破棄してしまうため、別のエラーコードを使う。
            console.error('[middleware] JWT has no session_id. userId:', user.id, 'path:', path);
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'error=session_init_failed';
            return redirectWithSession(url);
        }
        const { data: activity, error: activityError } = await supabaseAdmin
            .from('user_session_activity').select('session_hash')
            .eq('auth_session_id', sessionId).eq('user_id', user.id).is('revoked_at', null)
            .gte('last_activity', idleCutoff).gt('absolute_expires_at', now).maybeSingle();
        if (activityError) {
            console.error('[middleware] session activity lookup failed', activityError.message, 'sessionId:', sessionId);
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'error=session_validation_unavailable';
            return redirectWithSession(url);
        }
        if (!activity && session?.access_token && isFreshJwt(session.access_token)) {
            const absoluteExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
            const { error: bootstrapError } = await supabaseAdmin.from('user_session_activity').upsert({
                session_hash: await hashAccessToken(session.access_token),
                auth_session_id: sessionId,
                user_id: user.id,
                last_activity: now,
                absolute_expires_at: absoluteExpiresAt,
                revoked_at: null,
            }, { onConflict: 'session_hash' });
            if (!bootstrapError) {
                console.warn('[middleware] bootstrapped missing fresh session activity. sessionId:', sessionId, 'userId:', user.id);
                response.headers.set('Content-Security-Policy', csp);
                return response;
            }
            console.error('[middleware] session activity bootstrap failed', bootstrapError.message, 'sessionId:', sessionId);
        }
        if (!activity) {
            console.error('[middleware] session activity not found. sessionId:', sessionId, 'userId:', user.id, 'idleCutoff:', idleCutoff);
            const url = request.nextUrl.clone();
            url.pathname = '/';
            url.search = 'reason=idle_timeout';
            return redirectWithSession(url);
        }
    }

    response.headers.set('Content-Security-Policy', csp);
    return response;
}
