// app/actions/super-admin.ts
'use server';

import { supabaseAdmin, assertSuperAdmin } from '@/utils/supabase/auth';

// 全事業所の一覧を取得
export async function getAllOrganizations() {
    await assertSuperAdmin();
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
    type OrgRow = {
        id: string;
        name: string;
        created_at: string;
        profiles: { count: number }[];
        clients: { count: number }[];
    };
    return (orgs as OrgRow[]).map((org) => ({
        id: org.id,
        name: org.name,
        createdAt: org.created_at,
        staffCount: org.profiles[0]?.count || 0,
        clientCount: org.clients[0]?.count || 0,
    }));
}

// 事業所の削除（危険操作）
export async function deleteOrganization(orgId: string) {
    await assertSuperAdmin();
    const { error } = await supabaseAdmin
        .from('organizations')
        .delete()
        .eq('id', orgId);

    if (error) throw new Error(error.message);
    return { success: true };
}