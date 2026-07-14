// app/actions/super-admin.ts
'use server';

import { sanitizeDbError } from '@/utils/errors';

import { supabaseAdmin, assertSuperAdmin } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';

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
    if (readError) throw sanitizeDbError(readError, 'action.super-admin.read');

    const { count: memberCount, error: memberCountError } = await supabaseAdmin
        .from('organization_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('organization_id', orgId);
    if (memberCountError) throw sanitizeDbError(memberCountError, 'action.super-admin.member-count');

    const deletedAt = new Date();
    const retentionUntil = new Date(deletedAt);
    retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (organization.retention_years || 5));

    await recordAuditEvent({
        organizationId: orgId,
        actorId: userId,
        action: 'super_admin.organization.delete',
        resourceType: 'organization',
        resourceId: orgId,
        details: { organizationId: orgId, removedMembers: memberCount ?? 0, retentionUntil: retentionUntil.toISOString() },
    });
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
    const { error: profileError } = await supabaseAdmin.from('profiles').update({ last_organization_id: null }).eq('last_organization_id', orgId);
    if (profileError) throw sanitizeDbError(profileError, 'action.super-admin.clear-profiles');
    const { error: memberError } = await supabaseAdmin.from('organization_members').delete().eq('organization_id', orgId);
    if (memberError) throw sanitizeDbError(memberError, 'action.super-admin.remove-members');
    return { success: true };
}
