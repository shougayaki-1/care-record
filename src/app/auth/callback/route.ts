import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase'; // 既存のクライアントを流用

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    // nextパラメータがあればそこへ、なければダッシュボードへ
    const next = searchParams.get('next') ?? '/admin/dashboard';

    if (code) {
        // サーバーサイドでのセッション交換
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`);
        }
    }

    // エラー時はトップへ
    return NextResponse.redirect(`${origin}/`);
}