// app/actions/staff.ts
'use server';

import { createClient } from '@supabase/supabase-js';

// 管理者権限を持つクライアントを作成
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/**
 * パターン3: 管理者が直接スタッフアカウントを作成する
 */
export async function createStaffDirectly(params: {
    email: string;
    password: string;
    name: string;
    organizationId: string;
    assignedClientIds: string[];
}) {
    const { email, password, name, organizationId, assignedClientIds } = params;

    // 1. Authユーザー作成 (管理者のセッションには影響しない)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true // 確認メールをスキップ
    });

    if (authError) throw new Error(authError.message);
    if (!authData.user) throw new Error('ユーザー作成に失敗しました');

    const userId = authData.user.id;

    // 2. プロフィール作成
    const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
            id: userId,
            organization_id: organizationId,
            name: name,
            role: 'staff'
        });

    if (profileError) {
        // 失敗したらAuthユーザーも消すべきだが、今回は簡易実装
        throw new Error('プロフィール作成エラー: ' + profileError.message);
    }

    // 3. 担当割り当て (もしあれば)
    if (assignedClientIds.length > 0) {
        const assignments = assignedClientIds.map(clientId => ({
            helper_id: userId,
            client_id: clientId
        }));

        const { error: assignError } = await supabaseAdmin
            .from('assignments')
            .insert(assignments);

        if (assignError) {
            console.error('担当割り当てエラー:', assignError);
            // ここは致命的なエラーではないのでスルーまたは警告
        }
    }

    return { success: true, userId };
}