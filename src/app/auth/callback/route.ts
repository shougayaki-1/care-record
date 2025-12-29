// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');

    if (code) {
        // 1. コードをセッションに交換
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error) {
            // 2. ユーザー情報を取得して振り分け判定
            const { data: { user } } = await supabase.auth.getUser();

            if (user) {
                // プロフィールが存在するかチェック
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', user.id)
                    .maybeSingle();

                if (profile) {
                    // 既存ユーザー：権限に応じてダッシュボードかヘルパー画面へ
                    if (profile.role === 'staff') {
                        return NextResponse.redirect(`${origin}/helper`);
                    } else {
                        return NextResponse.redirect(`${origin}/admin/dashboard`);
                    }
                } else {
                    // 新規ユーザー：セットアップ画面へ
                    return NextResponse.redirect(`${origin}/setup`);
                }
            }
        }
    }

    // エラー時はトップへ戻す
    return NextResponse.redirect(`${origin}/`);
}