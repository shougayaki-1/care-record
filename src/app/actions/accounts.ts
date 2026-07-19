'use server';

import { sanitizeDbError } from '@/utils/errors';

import { randomUUID } from 'crypto';
import { getAuthedUser, assertOrgRole, assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import { serviceRoleForAuthManagement } from '@/utils/supabase/serviceRole';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { isDangerousPermissions } from '@/utils/supabase/roleSafety';
import type { RolePermissions } from '@/utils/permissions';

const supabaseAdmin = serviceRoleForAuthManagement();

async function assertDangerousRoleOwnerCheck(
  orgId: string,
  roleIds: string[],
  isOwner: boolean,
): Promise<void> {
  if (roleIds.length === 0) return;
  const sessionClient = await createSessionClient();
  const { data: orgRoles, error } = await sessionClient
    .from('organization_roles')
    .select('id, permissions')
    .eq('organization_id', orgId)
    .in('id', roleIds);
  if (error) throw new Error('ロール情報の取得に失敗しました');
  const hasDangerous = (orgRoles ?? []).some(r => isDangerousPermissions(r.permissions as RolePermissions));
  if (hasDangerous && !isOwner) {
    throw new Error('危険な権限を含むロールの付与はオーナーのみ実行できます');
  }
}

const VALID_ROLES = ['owner', 'member'] as const;
type Role = (typeof VALID_ROLES)[number];

type MemberRow = { user_id: string; role: string };

export type AccountOverviewItem = {
    id: string;
    name: string;
    email?: string;
    role: string;  // base org role: 'owner' | 'member'
    roles: { id: string; name: string; color: string | null }[];  // effective roles from organization_roles
    status: 'active' | 'invited';
    invitation_code?: string;
    staffId?: string | null;
    staffName?: string | null;
};

export async function getAccountOverview(orgId: string): Promise<{ currentUserId: string; accounts: AccountOverviewItem[] }> {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    const sessionClient = await createSessionClient();
    const [{ data: members, error: membersError }, { data: invitations, error: invitationsError }] = await Promise.all([
        sessionClient.from('organization_members').select('user_id, role').eq('organization_id', orgId),
        sessionClient.from('invitations')
            .select('id, target_name, role, role_ids, code, staff_id, staffs(name)')
            .eq('organization_id', orgId)
            .eq('is_used', false)
            .gt('expires_at', new Date().toISOString()),
    ]);
    if (membersError || invitationsError) throw new Error('アカウント情報を取得できませんでした');

    const memberRows = (members || []) as MemberRow[];
    const memberIds = memberRows.map((member) => member.user_id);
    const [{ data: profiles, error: profilesError }, { data: memberRoles, error: memberRolesError }] = await Promise.all([
        memberIds.length
            ? sessionClient.from('profiles').select('id, name').in('id', memberIds)
            : Promise.resolve({ data: [], error: null }),
        memberIds.length
            ? sessionClient
                .from('organization_member_roles')
                .select('user_id, organization_roles(id, name, color)')
                .eq('organization_id', orgId)
                .in('user_id', memberIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesError) throw new Error('プロフィール情報を取得できませんでした');
    if (memberRolesError) throw new Error('ロール情報を取得できませんでした');

    const profileNames = new Map((profiles || []).map((profile) => [profile.id, profile.name]));
    const authEmails = new Map<string, string>();
    if (memberIds.length > 0) {
        const memberIdSet = new Set(memberIds);
        const perPage = 1000;
        let page = 1;
        while (true) {
            const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
            if (error) throw new Error('アカウント情報を取得できませんでした');
            for (const user of data.users) {
                if (memberIdSet.has(user.id) && user.email) authEmails.set(user.id, user.email);
            }
            if (data.users.length < perPage) break;
            page += 1;
        }
    }

    // Build a map of userId -> roles[]
    const rolesMap = new Map<string, { id: string; name: string; color: string | null }[]>();
    for (const row of (memberRoles || []) as { user_id: string; organization_roles: { id: string; name: string; color: string | null } | null }[]) {
        if (!row.organization_roles) continue;
        const existing = rolesMap.get(row.user_id) ?? [];
        existing.push(row.organization_roles);
        rolesMap.set(row.user_id, existing);
    }

    const accounts: AccountOverviewItem[] = memberRows.map((member) => ({
        id: member.user_id,
        name: profileNames.get(member.user_id) || '名前未設定',
        email: authEmails.get(member.user_id),
        role: member.role,
        roles: rolesMap.get(member.user_id) ?? [],
        status: 'active',
    }));
    const inviteRows = (invitations || []) as Array<{
        id: string;
        target_name: string | null;
        role: string | null;
        role_ids: string[] | null;
        code: string;
        staff_id: string | null;
        staffs: { name: string } | { name: string }[] | null;
    }>;
    const inviteRoleIds = Array.from(new Set(inviteRows.flatMap((invitation) => invitation.role_ids ?? [])));
    const inviteRoleMap = new Map<string, { id: string; name: string; color: string | null }>();
    if (inviteRoleIds.length > 0) {
        const { data: inviteRoles, error: inviteRolesError } = await sessionClient
            .from('organization_roles')
            .select('id, name, color')
            .eq('organization_id', orgId)
            .in('id', inviteRoleIds);
        if (inviteRolesError) throw new Error('招待ロール情報を取得できませんでした');
        (inviteRoles || []).forEach((role) => inviteRoleMap.set(role.id, role));
    }

    for (const invitation of inviteRows) {
        const staff = Array.isArray(invitation.staffs) ? invitation.staffs[0] : invitation.staffs;
        accounts.push({
            id: invitation.id,
            name: invitation.target_name || '名前未設定',
            role: invitation.role ?? 'member',
            roles: (invitation.role_ids ?? []).map((roleId) => inviteRoleMap.get(roleId)).filter((role): role is { id: string; name: string; color: string | null } => Boolean(role)),
            status: 'invited',
            staffId: invitation.staff_id,
            staffName: staff?.name ?? null,
            ...(isOwner ? { invitation_code: invitation.code } : {}),
        });
    }

    return { currentUserId: userId, accounts };
}

/**
 * 招待コードで事業所に参加する。
 * 招待の検証・ロール付与・使用済みフラグ更新を認証済みRPCで原子的に行う。
 * これにより organization_members への自己挿入(任意ロール化)を RLS で禁止できる。
 */
export async function acceptInvitation(code: string) {
    const user = await getAuthedUser();
    if (!code?.trim()) throw new Error('招待コードが不正です');
    const supabase = await createSessionClient();
    const { data: organizationId, error } = await supabase.rpc('accept_invitation_atomic', {
        p_code: code.trim(), p_session_id: user.sessionId,
    });
    if (error?.message === 'already_member') {
        // 招待は消費されていないので code から org_id を逆引きできる
        const { data: invite } = await supabase
            .from('invitations')
            .select('organization_id')
            .eq('code', code.trim())
            .maybeSingle();
        return { success: true, organizationId: invite?.organization_id ?? '', alreadyMember: true };
    }
    if (error || !organizationId) throw new Error('無効、期限切れ、または使用済みの招待コードです');
    return { success: true, organizationId: String(organizationId), alreadyMember: false };
}

/**
 * 招待リンク（invitations）を発行する。owner のみ。
 * code はサーバ側で生成し、actor も改ざんできないようセッションから取得する。
 */
export async function createInvitation(orgId: string, params: { targetName: string; email: string; roleIds?: string[]; staffId?: string | null }) {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    await assertDangerousRoleOwnerCheck(orgId, params.roleIds ?? [], isOwner);
    const targetName = params.targetName.trim();
    const email = params.email.trim().toLowerCase();
    const sessionClient = await createSessionClient();
    if (targetName.length < 1 || targetName.length > 100) throw new Error('招待する人の名前を1〜100文字で入力してください');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) throw new Error('招待先メールアドレスを入力してください');

    if (params.staffId) {
        const { data: staff, error: staffError } = await sessionClient
            .from('staffs')
            .select('id, user_id')
            .eq('id', params.staffId)
            .eq('organization_id', orgId)
            .is('deleted_at', null)
            .maybeSingle();
        if (staffError || !staff) throw new Error('紐付けるスタッフが見つかりません');
        if (staff.user_id) throw new Error('このスタッフはすでにアカウントに紐付いています');
    }

    const code = randomUUID().slice(0, 8);
    const { error } = await sessionClient.rpc('create_invitation_authorized', {
        p_organization_id: orgId,
        p_code: code,
        p_email: email,
        p_target_name: targetName,
        p_role_ids: params.roleIds ?? [],
        p_staff_id: params.staffId ?? undefined,
    });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'account.invitation_create', resourceType: 'invitation', details: { roleIds: params.roleIds ?? [], staffId: params.staffId || null, targetName } });
    return { success: true, code };
}

/**
 * メンバー/招待の所有者区分を変更する。
 * 最後の owner の降格はサーバ側でも拒否する。
 */
export async function updateAccountRole(
    orgId: string,
    params: { targetId: string; status: 'active' | 'invited'; newRole: string }
) {
    const { userId } = await assertOrgPermission(orgId, 'accounts');
    const { targetId, status, newRole } = params;
    if (!VALID_ROLES.includes(newRole as Role)) throw new Error('権限が不正です');
    if (status === 'invited' && newRole === 'owner') {
        throw new Error('招待でオーナー権限は付与できません。参加後に権限を変更してください');
    }

    const sessionClient = await createSessionClient();
    const { error } = await sessionClient.rpc('account_update_role', {
        p_organization_id: orgId, p_target_id: targetId, p_status: status, p_new_role: newRole,
    });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'account.role_update', resourceType: 'account', resourceId: targetId, details: { status, newRole } });
    return { success: true };
}

/**
 * メンバーの除名 / 招待の取り消し。
 * 他人の除名は owner のみ。自分自身の脱退はメンバーであれば可。
 * 最後の owner はサーバ側でも削除を拒否する。
 */
export async function removeAccount(
    orgId: string,
    params: { targetId: string; status: 'active' | 'invited' }
) {
    const { id: callerId } = await getAuthedUser();
    const { targetId, status } = params;

    if (status === 'active' && targetId === callerId) {
        // 自己脱退: メンバーであればよい
        await assertOrgRole(orgId);
    } else {
        // 他メンバーの除名 / 招待取消はアカウント管理権限が必要
        await assertOrgPermission(orgId, 'accounts');
    }

    const sessionClient = await createSessionClient();
    const { error } = await sessionClient.rpc('account_remove', {
        p_organization_id: orgId, p_target_id: targetId, p_status: status,
    });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    await recordAuditEvent({ organizationId: orgId, actorId: callerId, action: status === 'active' ? 'account.remove' : 'account.invitation_revoke', resourceType: 'account', resourceId: targetId });
    return { success: true };
}

export type InvitationPreview = {
    valid: boolean;
    orgName?: string;
    targetName?: string;
    roleNames?: string[];
    expiresAt?: string;
};

/**
 * 招待コードから事業所名・ロール名を取得する（認証不要）。
 * 招待コードを持つ人に事業所名・ロール名を公開することは意図的。
 */
export async function getInvitationPreview(code: string): Promise<InvitationPreview> {
    if (!code?.trim()) return { valid: false };
    const sessionClient = await createSessionClient();
    const { data: inv } = await sessionClient.rpc('get_invitation_preview', { p_code: code.trim() });

    if (!inv) return { valid: false };

    const preview = inv as { organizationId: string; orgName: string; targetName: string | null; roleNames: string[]; expiresAt: string };
    return {
        valid: true,
        orgName: preview.orgName ?? '事業所',
        targetName: preview.targetName ?? undefined,
        roleNames: preview.roleNames,
        expiresAt: preview.expiresAt,
    };
}

export type InviteStaffCandidate = {
    id: string;
    name: string;
    positions: string[] | null;
};

export async function getInviteStaffCandidates(orgId: string): Promise<InviteStaffCandidate[]> {
    await assertOrgPermission(orgId, 'accounts');
    const sessionClient = await createSessionClient();
    const { data, error } = await sessionClient
        .from('staffs')
        .select('id, name, positions')
        .eq('organization_id', orgId)
        .is('user_id', null)
        .is('deleted_at', null)
        .is('archived_at', null)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    return (data ?? []) as InviteStaffCandidate[];
}

export async function getOrgRoles(orgId: string): Promise<{ id: string; name: string; color: string | null; is_preset: boolean; is_dangerous: boolean }[]> {
    await assertOrgRole(orgId);
    const sessionClient = await createSessionClient();
    const { data, error: rolesError } = await sessionClient
        .from('organization_roles')
        .select('id, name, color, is_preset, permissions')
        .eq('organization_id', orgId)
        .order('is_preset', { ascending: false });
    if (rolesError) throw new Error('ロール一覧を取得できませんでした');
    return (data ?? []).map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        is_preset: r.is_preset,
        is_dangerous: isDangerousPermissions(r.permissions as RolePermissions),
    }));
}

export async function updateMemberRoles(orgId: string, targetUserId: string, roleIds: string[]): Promise<void> {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    await assertDangerousRoleOwnerCheck(orgId, roleIds, isOwner);
    const sessionClient = await createSessionClient();
    const { error } = await sessionClient.rpc('account_replace_member_roles', {
        p_organization_id: orgId, p_target_user_id: targetUserId, p_role_ids: roleIds,
    });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'account.roles_update', resourceType: 'account', resourceId: targetUserId, details: { roleIds } });
}
