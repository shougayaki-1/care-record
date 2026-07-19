// src/utils/supabase/auth.ts
// Server Action 用の認証・認可ヘルパ。
// すべての Server Action は「クライアントが渡した userId/role」ではなく、
// クッキーセッションから解決した本人 (getAuthedUser) を信頼の起点とする。
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import type { Database } from '@/types/database.generated';
import { sanitizeDbError } from '@/utils/errors';
import { decodeJwtSessionId } from '@/utils/jwt';
import { SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES } from '@/utils/authConstants';
import {
  mergePermissions,
  FULL_PERMISSIONS,
  type RolePermissions, type ManagementArea, type RecordAction, type ShiftAction,
} from '@/utils/permissions';

export type OrgRole = 'owner' | 'member';
export { SESSION_IDLE_MINUTES, SESSION_ABSOLUTE_HOURS } from '@/utils/authConstants';

// 認可済みの基盤操作だけで使う管理クライアント。欠落時はダミー接続せず即座停止する。
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}
export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
    supabaseUrl,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * クッキーセッションに紐づく anon クライアントを生成する。
 * Server Action からは cookies() が利用できる。
 */
export async function createSessionClient(): Promise<SupabaseClient<Database>> {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) throw new Error('Supabase session environment is not configured');
    const cookieStore = await cookies();
    return createServerClient<Database>(
        supabaseUrl,
        anonKey,
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
    const sessionId = decodeJwtSessionId(accessToken);
    if (!sessionId) throw new Error('認証セッション識別子を検証できません');
    return sessionId;
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
    const { error } = await supabaseAdmin.from('user_session_activity').insert({
        session_hash: sessionHash,
        auth_session_id: authSessionId,
        user_id: session.user.id,
        last_activity: new Date().toISOString(),
        absolute_expires_at: absoluteExpiresAt,
        revoked_at: null,
    });
    if (error) {
        if (error.code === '23505') {
            const { data: existing, error: existingError } = await supabaseAdmin
                .from('user_session_activity')
                .select('auth_session_id')
                .eq('auth_session_id', authSessionId)
                .eq('user_id', session.user.id)
                .maybeSingle();
            if (!existingError && existing) return authSessionId;
        }
        console.error('[auth] registerSessionActivity failed:', error.message, 'authSessionId:', authSessionId, 'userId:', session.user.id);
        throw sanitizeDbError(error, 'auth.register-session');
    }
    console.log('[auth] Session activity registered. authSessionId:', authSessionId, 'userId:', session.user.id);
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

/** Cookie反映待ちのServer Action用。明示トークンも必ずAuthサーバーで検証する。 */
export async function getAuthedUserFromAccessToken(
    accessToken: string
): Promise<{ id: string; email?: string; sessionId: string }> {
    if (!accessToken) throw new Error('認証が必要です');
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !user) throw new Error('認証が必要です');

    const sessionId = getAuthSessionId(accessToken);
    const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const { data: activity, error: activityError } = await supabaseAdmin
        .from('user_session_activity')
        .select('session_hash')
        .eq('auth_session_id', sessionId)
        .eq('user_id', user.id)
        .is('revoked_at', null)
        .gte('last_activity', idleCutoff)
        .gt('absolute_expires_at', now)
        .maybeSingle();
    if (activityError || !activity) throw new Error('セッションの有効期限が切れています');
    return { id: user.id, email: user.email, sessionId };
}

/**
 * セッションのユーザーが対象 org のメンバーであり、許可ロールを満たすか検証する。
 * 満たさなければ例外。検証には *セッション由来の userId* のみを使う。
 * @returns 認証済みユーザーIDと、そのロール
 */
export async function assertOrgRole(
    organizationId: string,
    allowedRoles: OrgRole[] = ['owner', 'member']
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
    allowedRoles: OrgRole[] = ['owner', 'member']
): Promise<{ organizationId: string; userId: string; role: OrgRole }> {
    if (!resourceId) throw new Error('リソースIDが不正です');
    const query = supabaseAdmin
        .from(table as keyof Database['public']['Tables'])
        .select('*') as unknown as { eq: (column: string, value: string) => { single: () => Promise<{ data: unknown; error: unknown }> } };
    const { data, error } = await query.eq('id', resourceId).single();
    const resource = data as unknown as { organization_id?: string } | null;
    if (error || !resource?.organization_id) throw new Error('リソースが見つかりません');

    const { userId, role } = await assertOrgRole(resource.organization_id, allowedRoles);
    return { organizationId: resource.organization_id, userId, role };
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

/**
 * 組織メンバーの有効な権限を返す。
 * 割り当てられたロールをマージして有効権限を返す。
 * owner は所有権の識別であり、日常操作権限はロールで決まる。
 */
export async function getEffectivePermissions(
  organizationId: string,
  userId: string
): Promise<{ isOwner: boolean; permissions: RolePermissions }> {
  const { data: member, error } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .single();
  if (error || !member) throw new Error('この事業所へのアクセス権がありません');
  const { data: roleLinks } = await supabaseAdmin
    .from('organization_member_roles')
    .select('organization_roles(permissions)')
    .eq('organization_id', organizationId)
    .eq('user_id', userId);

  const rolePerms: RolePermissions[] = (roleLinks ?? [])
    .map((r) => (Array.isArray(r.organization_roles) ? r.organization_roles[0]?.permissions : r.organization_roles?.permissions) as RolePermissions | undefined)
    .filter((p): p is RolePermissions => p != null);

  const isOwner = member.role === 'owner';
  return { isOwner, permissions: isOwner ? FULL_PERMISSIONS : mergePermissions(rolePerms) };
}

/**
 * セッションのユーザーが対象 org の指定管理エリアへの権限を持つか検証する。
 * 満たさなければ例外。
 */
export async function assertOrgPermission(
  organizationId: string,
  area: ManagementArea
): Promise<{ userId: string; isOwner: boolean }> {
  if (!organizationId) throw new Error('organizationId が不正です');
  const user = await getAuthedUser();
  const { isOwner, permissions } = await getEffectivePermissions(organizationId, user.id);
  if (!isOwner && !permissions.management[area]) throw new Error('この操作を行う権限がありません');
  return { userId: user.id, isOwner };
}

type ReportPermissionTarget = {
  clientId?: string | null;
  reportId?: string | null;
  reportIds?: string[];
  includeDeleted?: boolean;
};

type ShiftPermissionTarget = {
  clientId?: string | null;
  clientIds?: string[];
  shiftId?: string | null;
  shiftIds?: string[];
  patternId?: string | null;
  patternIds?: string[];
  includeDeleted?: boolean;
  requireAllScope?: boolean;
};

type ReportPermissionActor = { userId: string; isOwner: boolean; clientIds: string[] };
type ShiftPermissionActor = { organizationId: string; userId: string; isOwner: boolean; clientIds: string[]; staffId: string | null };

async function getActorStaffId(organizationId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('staffs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error('スタッフ情報を確認できませんでした');
  return data?.id ?? null;
}

async function getAssignedClientIds(organizationId: string, userId: string): Promise<Set<string>> {
  const staffId = await getActorStaffId(organizationId, userId);
  let query = supabaseAdmin
    .from('assignments')
    .select('client_id, helper_id, staff_id, clients!inner(organization_id, deleted_at)')
    .eq('clients.organization_id', organizationId)
    .is('clients.deleted_at', null);
  if (staffId) {
    query = query.or(`helper_id.eq.${userId},staff_id.eq.${staffId}`);
  } else {
    query = query.eq('helper_id', userId);
  }
  const { data, error } = await query;
  if (error) throw new Error('担当利用者を確認できませんでした');
  return new Set((data ?? []).map((row) => row.client_id as string));
}

async function resolveReportClientIds(
  organizationId: string,
  target: ReportPermissionTarget,
): Promise<string[]> {
  const clientIds = new Set<string>();
  if (target.clientId) clientIds.add(target.clientId);

  const reportIds = Array.from(new Set([...(target.reportId ? [target.reportId] : []), ...(target.reportIds ?? [])].filter(Boolean)));
  if (reportIds.length > 0) {
    let query = supabaseAdmin
      .from('reports')
      .select('id, client_id, clients!inner(organization_id)')
      .in('id', reportIds)
      .eq('clients.organization_id', organizationId);
    if (!target.includeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw new Error('記録の所属を確認できませんでした');
    if ((data ?? []).length !== reportIds.length) throw new Error('記録にアクセスできません');
    for (const row of data ?? []) clientIds.add(row.client_id as string);
  }

  if (clientIds.size === 0) throw new Error('権限確認対象が不正です');
  return [...clientIds];
}

async function resolveShiftTargets(
  organizationId: string,
  target: ShiftPermissionTarget,
): Promise<{ clientIds: string[]; shiftIds: string[]; clientIdByShiftId: Map<string, string> }> {
  const clientIds = new Set<string>();
  const shiftIds = new Set<string>();
  const clientIdByShiftId = new Map<string, string>();
  if (target.clientId) clientIds.add(target.clientId);
  for (const id of target.clientIds ?? []) if (id) clientIds.add(id);

  const directShiftIds = Array.from(new Set([...(target.shiftId ? [target.shiftId] : []), ...(target.shiftIds ?? [])].filter(Boolean)));
  if (directShiftIds.length > 0) {
    let query = supabaseAdmin
      .from('shifts')
      .select('id, client_id, organization_id')
      .in('id', directShiftIds)
      .eq('organization_id', organizationId);
    if (!target.includeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw new Error('シフトの所属を確認できませんでした');
    if ((data ?? []).length !== directShiftIds.length) throw new Error('シフトにアクセスできません');
    for (const row of data ?? []) {
      shiftIds.add(row.id as string);
      const clientId = row.client_id as string;
      clientIds.add(clientId);
      clientIdByShiftId.set(row.id as string, clientId);
    }
  }

  const patternIds = Array.from(new Set([...(target.patternId ? [target.patternId] : []), ...(target.patternIds ?? [])].filter(Boolean)));
  if (patternIds.length > 0) {
    let query = supabaseAdmin
      .from('shift_patterns')
      .select('id, client_id, organization_id')
      .in('id', patternIds)
      .eq('organization_id', organizationId);
    if (!target.includeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw new Error('シフトひな形の所属を確認できませんでした');
    if ((data ?? []).length !== patternIds.length) throw new Error('シフトひな形にアクセスできません');
    for (const row of data ?? []) clientIds.add(row.client_id as string);
  }

  if (clientIds.size === 0 && shiftIds.size === 0 && target.requireAllScope == null) {
    throw new Error('権限確認対象が不正です');
  }
  return { clientIds: [...clientIds], shiftIds: [...shiftIds], clientIdByShiftId };
}

async function assertAssignedClients(organizationId: string, userId: string, clientIds: string[]): Promise<void> {
  const assignedClientIds = await getAssignedClientIds(organizationId, userId);
  if (clientIds.some((id) => !assignedClientIds.has(id))) {
    throw new Error('この操作を行う権限がありません');
  }
}

async function assertAssignedShifts(
  organizationId: string,
  userId: string,
  staffId: string | null,
  clientIds: string[],
  shiftIds: string[],
  clientIdByShiftId: Map<string, string>,
): Promise<void> {
  const assignedClientIds = await getAssignedClientIds(organizationId, userId);
  const ownShiftIds = new Set<string>();
  if (shiftIds.length > 0 && staffId) {
    const { data, error } = await supabaseAdmin
      .from('shift_staffs')
      .select('shift_id')
      .in('shift_id', shiftIds)
      .eq('staff_id', staffId);
    if (error) throw new Error('シフト担当を確認できませんでした');
    for (const row of data ?? []) ownShiftIds.add(row.shift_id as string);
  }

  for (const shiftId of shiftIds) {
    const clientId = clientIdByShiftId.get(shiftId);
    if (!ownShiftIds.has(shiftId) && (!clientId || !assignedClientIds.has(clientId))) {
      throw new Error('この操作を行う権限がありません');
    }
  }

  const standaloneClientIds = clientIds.filter((clientId) => ![...clientIdByShiftId.values()].includes(clientId));
  if (standaloneClientIds.some((id) => !assignedClientIds.has(id))) {
    throw new Error('この操作を行う権限がありません');
  }
}

export async function assertRecordPermission(
  organizationId: string,
  action: RecordAction,
  target: ReportPermissionTarget,
): Promise<ReportPermissionActor> {
  if (!organizationId) throw new Error('organizationId が不正です');
  const user = await getAuthedUser();
  const { isOwner, permissions } = await getEffectivePermissions(organizationId, user.id);
  const clientIds = await resolveReportClientIds(organizationId, target);
  if (isOwner || permissions.records[action] === 'all') return { userId: user.id, isOwner, clientIds };
  if (permissions.records[action] === 'assigned') {
    await assertAssignedClients(organizationId, user.id, clientIds);
    return { userId: user.id, isOwner, clientIds };
  }
  throw new Error('この操作を行う権限がありません');
}

export async function assertShiftPermission(
  organizationId: string,
  action: ShiftAction,
  target: ShiftPermissionTarget,
): Promise<ShiftPermissionActor> {
  if (!organizationId) throw new Error('organizationId が不正です');
  const user = await getAuthedUser();
  const { isOwner, permissions } = await getEffectivePermissions(organizationId, user.id);
  const { clientIds, shiftIds, clientIdByShiftId } = await resolveShiftTargets(organizationId, target);
  const staffId = await getActorStaffId(organizationId, user.id);
  if (isOwner || permissions.shifts[action] === 'all') return { organizationId, userId: user.id, isOwner, clientIds, staffId };
  if (target.requireAllScope || permissions.shifts[action] !== 'assigned') {
    throw new Error('この操作を行う権限がありません');
  }
  if (clientIds.length === 0 && shiftIds.length === 0) {
    const assignedClientIds = await getAssignedClientIds(organizationId, user.id);
    return { organizationId, userId: user.id, isOwner, clientIds: [...assignedClientIds], staffId };
  }
  await assertAssignedShifts(organizationId, user.id, staffId, clientIds, shiftIds, clientIdByShiftId);
  return { organizationId, userId: user.id, isOwner, clientIds, staffId };
}

/**
 * リソースの organization_id を解決してから assertOrgPermission を呼ぶヘルパ。
 */
export async function assertResourceOrgPermission(
  table: string,
  resourceId: string,
  area: ManagementArea
): Promise<{ organizationId: string; userId: string; isOwner: boolean }> {
  if (!resourceId) throw new Error('リソースIDが不正です');
  const query = supabaseAdmin
    .from(table as keyof Database['public']['Tables'])
    .select('*') as unknown as { eq: (column: string, value: string) => { single: () => Promise<{ data: unknown; error: unknown }> } };
  const { data, error } = await query.eq('id', resourceId).single();
  const resource = data as unknown as { organization_id?: string } | null;
  if (error || !resource?.organization_id) throw new Error('リソースが見つかりません');
  const { userId, isOwner } = await assertOrgPermission(resource.organization_id, area);
  return { organizationId: resource.organization_id, userId, isOwner };
}

/**
 * セッションのユーザーが対象 org のオーナーか検証する。満たさなければ例外。
 */
export async function assertOwner(organizationId: string): Promise<{ userId: string }> {
  if (!organizationId) throw new Error('organizationId が不正です');
  const user = await getAuthedUser();
  const { data: member, error } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();
  if (error || !member || member.role !== 'owner') throw new Error('オーナー権限が必要です');
  return { userId: user.id };
}
