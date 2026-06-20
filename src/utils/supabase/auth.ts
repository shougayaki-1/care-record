// src/utils/supabase/auth.ts
// Server Action 用の認証・認可ヘルパ。
// すべての Server Action は「クライアントが渡した userId/role」ではなく、
// クッキーセッションから解決した本人 (getAuthedUser) を信頼の起点とする。
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

export type OrgRole = 'owner' | 'manager' | 'staff';
export const SESSION_IDLE_MINUTES = 16;
export const SESSION_ABSOLUTE_HOURS = 12;

// RLS をバイパスする管理クライアント（検証通過後の実処理用に共有）
// フォールバック値により、環境変数未設定でもモジュール初期化時に throw しない。
// 未設定の場合は各 Server Action 内の try-catch が 401/network エラーを捕捉する。
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[auth] SUPABASE_SERVICE_ROLE_KEY is not set. All admin operations will fail.');
}
export const supabaseAdmin: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://missing-supabase-url.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key',
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
function hashAccessToken(accessToken: string): string {
    return createHash('sha256').update(accessToken).digest('hex');
}

function getAuthSessionId(accessToken: string): string {
    try {
        const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { session_id?: string };
        if (!payload.session_id) throw new Error('missing session_id');
        return payload.session_id;
    } catch {
        throw new Error('認証セッション識別子を検証できません');
    }
}

async function getVerifiedAuthContext(): Promise<{ id: string; email?: string; authSessionId: string; session: Session }> {
    const supabase = await createSessionClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('認証が必要です');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('有効なセッションがありません');
    return { id: user.id, email: user.email, authSessionId: getAuthSessionId(session.access_token), session };
}

/** ログイン直後に、検証済みSupabaseセッションをサーバー管理の活動記録へ登録する。 */
export async function registerSessionActivity(session: Session): Promise<string> {
    const sessionHash = hashAccessToken(session.access_token);
    const authSessionId = getAuthSessionId(session.access_token);
    const absoluteExpiresAt = new Date(Date.now() + SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin.from('user_session_activity').upsert({
        session_hash: sessionHash,
        auth_session_id: authSessionId,
        user_id: session.user.id,
        last_activity: new Date().toISOString(),
        absolute_expires_at: absoluteExpiresAt,
        revoked_at: null,
    }, { onConflict: 'session_hash' });
    if (error) throw new Error(`セッションを登録できませんでした: ${error.message}`);
    return authSessionId;
}

/** ユーザー操作を検証した上で、現在のセッション活動時刻を更新する。 */
export async function touchCurrentSession(): Promise<{ userId: string; sessionId: string }> {
    const context = await getVerifiedAuthContext();
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('user_session_activity')
        .update({ last_activity: now })
        .eq('auth_session_id', context.authSessionId)
        .eq('user_id', context.id)
        .is('revoked_at', null)
        .gt('absolute_expires_at', now)
        .select('session_hash')
        .maybeSingle();
    if (error || !data) throw new Error('セッションの有効期限が切れています');
    return { userId: context.id, sessionId: context.authSessionId };
}

export async function revokeCurrentSession(): Promise<void> {
    const context = await getVerifiedAuthContext();
    await supabaseAdmin.from('user_session_activity')
        .update({ revoked_at: new Date().toISOString() })
        .eq('auth_session_id', context.authSessionId)
        .eq('user_id', context.id);
}

/** 認証と、改ざんできないサーバー側のアイドル・絶対有効期限を検証する。 */
export async function getAuthedUser(): Promise<{ id: string; email?: string; sessionId: string }> {
    const context = await getVerifiedAuthContext();
    const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('user_session_activity')
        .select('session_hash')
        .eq('auth_session_id', context.authSessionId)
        .eq('user_id', context.id)
        .is('revoked_at', null)
        .gte('last_activity', idleCutoff)
        .gt('absolute_expires_at', now)
        .maybeSingle();
    if (error || !data) throw new Error('セッションの有効期限が切れています');
    return { id: context.id, email: context.email, sessionId: context.authSessionId };
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
