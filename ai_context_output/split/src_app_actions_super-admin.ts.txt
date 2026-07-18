// app/actions/super-admin.ts
'use server';

import { sanitizeDbError } from '@/utils/errors';

import { assertSuperAdmin } from '@/utils/supabase/auth';
import { serviceRoleForPlatformMetadata } from '@/utils/supabase/serviceRole';

const supabaseAdmin = serviceRoleForPlatformMetadata();

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

// super adminは顧客データに対する削除経路を持たない。
export async function deleteOrganization(orgId: string) {
    await assertSuperAdmin();
    void orgId;
    throw new Error('super adminから顧客事業所を削除できません');
}
