// app/actions/super-admin.ts
'use server';

import { createClient } from '@supabase/supabase-js';

// 管理者権限を持つクライアント（全データにアクセス可能）
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

// 全事業所の一覧を取得
export async function getAllOrganizations() {
    // 事業所情報と、それに紐づくスタッフ数、利用者数を取得
    const { data: orgs, error } = await supabaseAdmin
        .from('organizations')
        .select(`
      id,
      name,
      created_at,
      profiles (count),
      clients (count)
    `)
        .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    // 整形して返す
    return orgs.map((org: any) => ({
        id: org.id,
        name: org.name,
        createdAt: org.created_at,
        staffCount: org.profiles[0]?.count || 0,
        clientCount: org.clients[0]?.count || 0,
    }));
}

// 事業所の削除（危険操作）
export async function deleteOrganization(orgId: string) {
    const { error } = await supabaseAdmin
        .from('organizations')
        .delete()
        .eq('id', orgId);

    if (error) throw new Error(error.message);
    return { success: true };
}