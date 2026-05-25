'use server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ActionResponse } from '@/types';

export async function deleteUserAccount(userId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
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
                            // エラー無視しつつCookieを同期
                        }
                    },
                },
            }
        );

        const { data: { user } } = await supabase.auth.getUser();
        if (!user || user.id !== userId) {
            throw new Error('本人のアカウント以外は削除できません。');
        }

        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (error) throw new Error(error.message);

        return { status: 'success', data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}