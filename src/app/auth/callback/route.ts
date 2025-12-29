// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    // ログイン後のデフォルトリダイレクト先
    let next = '/admin/dashboard';

    if (code) {
        const cookieStore = await cookies(); // Next.js 15/16ではawaitが必要

        // サーバーサイド用のSupabaseクライアントを作成
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value;
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options });
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.delete({ name, ...options });
                    },
                },
            }
        );

        // コードをセッションに交換 (ここでCookieがセットされる)
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error) {
            // ユーザー情報を取得して振り分け判定
            const { data: { user } } = await supabase.auth.getUser();

            if (user) {
                // プロフィールが存在するかチェック
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', user.id)
                    .maybeSingle();

                if (profile) {
                    // 既存ユーザー：権限に応じて振り分け
                    if (profile.role === 'staff') {
                        next = '/helper';
                    } else if (profile.role === 'super_admin') {
                        next = '/super-admin';
                    } else {
                        next = '/admin/dashboard';
                    }
                } else {
                    // 新規ユーザー：セットアップ画面へ
                    next = '/setup';
                }

                // 成功時のリダイレクト
                return NextResponse.redirect(`${origin}${next}`);
            }
        } else {
            console.error('Auth Exchange Error:', error);
        }
    }

    // エラー時やコードがない場合はトップへ戻す
    return NextResponse.redirect(`${origin}/`);
}