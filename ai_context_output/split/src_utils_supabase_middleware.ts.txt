import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    // リクエスト側のCookieを更新
                    cookiesToSet.forEach(({ name, value, options }) =>
                        request.cookies.set(name, value),
                    );
                    
                    // レスポンスを再作成して最新の状態にする（これが重要）
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    });
                    
                    // ★修正点: 手動でのオプション上書きをやめ、Supabaseのoptionsをそのまま使う
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                },
            },
        }
    );

    // セッションをリフレッシュ
    await supabase.auth.getUser();

    return response;
}