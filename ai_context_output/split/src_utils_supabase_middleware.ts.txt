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
                // optionsを使用しない場合は _options とするか、削除
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => // options削除
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

    await supabase.auth.getUser();

    return response;
}