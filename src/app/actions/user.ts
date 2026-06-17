'use server';

import { supabaseAdmin, getAuthedUser } from '@/utils/supabase/auth';

export async function deleteUserAccount() {
    // 退会できるのは本人のみ。対象 userId はセッションから取得する
    const { id: userId } = await getAuthedUser();
    // Authユーザー削除 (関連するpublicテーブルのデータはカスケード設定またはTriggerで削除される前提)
    // ここではAuth削除のみ行う
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { success: true };
}