// app/actions/super-admin.ts
'use server';

import { sanitizeDbError } from '@/utils/errors';

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
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

    if (error) throw sanitizeDbError(error, 'action.super-admin');

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
    const { userId } = await assertSuperAdmin();
    const { data: organization, error: readError } = await supabaseAdmin
        .from('organizations')
        .select('retention_years')
        .eq('id', orgId)
        .single();
    if (readError) throw new Error(readError.message);

    const deletedAt = new Date();
    const retentionUntil = new Date(deletedAt);
    retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (organization.retention_years || 5));
    const { error } = await supabaseAdmin
        .from('organizations')
        .update({
            deleted_at: deletedAt.toISOString(),
            deleted_by: userId,
            retention_until: retentionUntil.toISOString(),
        })
        .eq('id', orgId)
        .is('deleted_at', null);

    if (error) throw sanitizeDbError(error, 'action.super-admin');
    await supabaseAdmin.from('profiles').update({ last_organization_id: null }).eq('last_organization_id', orgId);
    await supabaseAdmin.from('organization_members').delete().eq('organization_id', orgId);
    return { success: true };
}
