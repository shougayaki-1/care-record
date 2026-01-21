'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function deleteUserAccount(userId: string) {
    // Authユーザー削除 (関連するpublicテーブルのデータはカスケード設定またはTriggerで削除される前提)
    // ここではAuth削除のみ行う
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { success: true };
}