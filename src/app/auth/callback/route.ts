import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    // デフォルトのリダイレクト先
    let next = '/admin/dashboard';

    if (code) {
        const cookieStore = await cookies();

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            );
                        } catch {
                            // Server Component から呼ばれた場合は無視されることがあるが問題なし
                        }
                    },
                },
            }
        );

        // コードをセッションに交換
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
                    // 既存ユーザー
                    if (profile.role === 'staff') {
                        next = '/helper';
                    } else if (profile.role === 'super_admin') {
                        next = '/super-admin';
                    } else {
                        next = '/admin/dashboard';
                    }
                } else {
                    // 新規ユーザー -> セットアップへ
                    next = '/setup';
                }

                // 成功: 意図したページへリダイレクト
                return NextResponse.redirect(`${origin}${next}`);
            }
        } else {
            console.error('SSO Code Exchange Error:', error);
        }
    } else {
        console.error('No code received in callback');
    }

    // 失敗時はトップへ戻す（エラー表示パラメータ付き）
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
}