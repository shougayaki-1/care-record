// src/utils/supabase/auth.ts
// Server Action 用の認証・認可ヘルパ。
// すべての Server Action は「クライアントが渡した userId/role」ではなく、
// クッキーセッションから解決した本人 (getAuthedUser) を信頼の起点とする。
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type OrgRole = 'owner' | 'manager' | 'staff';

// RLS をバイパスする管理クライアント（検証通過後の実処理用に共有）
export const supabaseAdmin: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * クッキーセッションに紐づく anon クライアントを生成する。
 * Server Action からは cookies() が利用できる。
 */
export async function createSessionClient(): Promise<SupabaseClient> {
    const cookieStore = await cookies();
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: (cookiesToSet) => {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // Server Component から呼ばれた等で書き込めない場合は無視（middleware が更新を担保）
                    }
                },
            },
        }
    );
}

/**
 * 認証済みユーザーを返す。未認証なら例外。
 * getUser() は Auth サーバへ問い合わせて検証するため信頼できる。
 */
export async function getAuthedUser(): Promise<{ id: string; email?: string }> {
    const supabase = await createSessionClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('認証が必要です');
    return { id: user.id, email: user.email };
}

/**
 * セッションのユーザーが対象 org のメンバーであり、許可ロールを満たすか検証する。
 * 満たさなければ例外。検証には *セッション由来の userId* のみを使う。
 * @returns 認証済みユーザーIDと、そのロール
 */
export async function assertOrgRole(
    organizationId: string,
    allowedRoles: OrgRole[] = ['owner', 'manager', 'staff']
): Promise<{ userId: string; role: OrgRole }> {
    if (!organizationId) throw new Error('organizationId が不正です');
    const user = await getAuthedUser();

    const { data: member, error } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .single();

    if (error || !member) throw new Error('この事業所へのアクセス権がありません');
    if (!allowedRoles.includes(member.role as OrgRole)) {
        throw new Error('この操作を行う権限がありません');
    }
    return { userId: user.id, role: member.role as OrgRole };
}

/**
 * shiftId など org に属するリソースの organization_id を引き、そのメンバー権限を検証する。
 * @returns 解決した organizationId と認証済みユーザー情報
 */
export async function assertResourceOrgRole(
    table: string,
    resourceId: string,
    allowedRoles: OrgRole[] = ['owner', 'manager', 'staff']
): Promise<{ organizationId: string; userId: string; role: OrgRole }> {
    if (!resourceId) throw new Error('リソースIDが不正です');
    const { data, error } = await supabaseAdmin
        .from(table)
        .select('organization_id')
        .eq('id', resourceId)
        .single();
    if (error || !data?.organization_id) throw new Error('リソースが見つかりません');

    const { userId, role } = await assertOrgRole(data.organization_id, allowedRoles);
    return { organizationId: data.organization_id, userId, role };
}

/**
 * セッションのユーザーが super_admin か検証する。満たさなければ例外。
 */
export async function assertSuperAdmin(): Promise<{ userId: string }> {
    const user = await getAuthedUser();
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (error || profile?.role !== 'super_admin') {
        throw new Error('管理者権限が必要です');
    }
    return { userId: user.id };
}
