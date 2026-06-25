'use server';

import { sanitizeDbError } from '@/utils/errors';

import { randomUUID } from 'crypto';
import { supabaseAdmin, getAuthedUser, assertOrgRole, assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertRoleManagerRemains } from '@/utils/supabase/roleSafety';

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
};

export async function getAccountOverview(orgId: string): Promise<{ currentUserId: string; accounts: AccountOverviewItem[] }> {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    const [{ data: members, error: membersError }, { data: invitations, error: invitationsError }] = await Promise.all([
        supabaseAdmin.from('organization_members').select('user_id, role').eq('organization_id', orgId),
        supabaseAdmin.from('invitations')
            .select('id, target_name, role, code')
            .eq('organization_id', orgId)
            .eq('is_used', false)
            .gt('expires_at', new Date().toISOString()),
    ]);
    if (membersError || invitationsError) throw new Error('アカウント情報を取得できませんでした');

    const memberRows = (members || []) as MemberRow[];
    const memberIds = memberRows.map((member) => member.user_id);
    const [{ data: profiles, error: profilesError }, { data: memberRoles, error: memberRolesError }] = await Promise.all([
        memberIds.length
            ? supabaseAdmin.from('profiles').select('id, name').in('id', memberIds)
            : Promise.resolve({ data: [], error: null }),
        memberIds.length
            ? supabaseAdmin
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
    await Promise.all(memberIds.map(async (memberId) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(memberId);
        if (data.user?.email) authEmails.set(memberId, data.user.email);
    }));

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
    for (const invitation of invitations || []) {
        accounts.push({
            id: invitation.id,
            name: invitation.target_name || '名前未設定',
            role: invitation.role ?? 'member',
            roles: [],
            status: 'invited',
            ...(isOwner ? { invitation_code: invitation.code } : {}),
        });
    }

    return { currentUserId: userId, accounts };
}

/**
 * 招待コードで事業所に参加する。
 * 招待の検証・ロール付与・使用済みフラグ更新をサーバ側(service role)で原子的に行う。
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
        const { data: invite } = await supabaseAdmin
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
export async function createInvitation(orgId: string, params: { targetName?: string; roleIds?: string[] }) {
    const { userId } = await assertOrgPermission(orgId, 'accounts');

    const code = randomUUID().slice(0, 8);
    const { error } = await supabaseAdmin.from('invitations').insert({
        organization_id: orgId,
        code,
        created_by: userId,
        target_name: params.targetName || null,
        role_ids: params.roleIds ?? [],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'account.invitation_create', resourceType: 'invitation', details: { roleIds: params.roleIds ?? [] } });
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

    if (status === 'active') {
        const { data: members } = await supabaseAdmin
            .from('organization_members')
            .select('user_id, role')
            .eq('organization_id', orgId);
        const list = (members as MemberRow[]) || [];
        const target = list.find((m) => m.user_id === targetId);
        if (!target) throw new Error('対象のメンバーが見つかりません');

        if (target.role === 'owner' && newRole !== 'owner') {
            const owners = list.filter((m) => m.role === 'owner');
            if (owners.length <= 1) throw new Error('最後のオーナーの権限は変更できません');
        }

        const { error } = await supabaseAdmin
            .from('organization_members')
            .update({ role: newRole })
            .eq('organization_id', orgId)
            .eq('user_id', targetId);
        if (error) throw sanitizeDbError(error, 'action.accounts');
    } else {
        // 招待のロール変更。invitation が当該 org のものか必ず確認する
        const { data: inv } = await supabaseAdmin
            .from('invitations')
            .select('id')
            .eq('id', targetId)
            .eq('organization_id', orgId)
            .single();
        if (!inv) throw new Error('招待が見つかりません');

        const { error } = await supabaseAdmin
            .from('invitations')
            .update({ role: newRole })
            .eq('id', targetId)
            .eq('organization_id', orgId);
        if (error) throw sanitizeDbError(error, 'action.accounts');
    }
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

    if (status === 'active') {
        const { data: members } = await supabaseAdmin
            .from('organization_members')
            .select('user_id, role')
            .eq('organization_id', orgId);
        const list = (members as MemberRow[]) || [];
        const target = list.find((m) => m.user_id === targetId);
        if (!target) throw new Error('対象のメンバーが見つかりません');

        if (target.role === 'owner') {
            const owners = list.filter((m) => m.role === 'owner');
            if (owners.length <= 1) throw new Error('最後のオーナーは削除できません');
        }
        await assertRoleManagerRemains(orgId, { removedMemberId: targetId });

        const { error } = await supabaseAdmin
            .from('organization_members')
            .delete()
            .eq('organization_id', orgId)
            .eq('user_id', targetId);
        if (error) throw sanitizeDbError(error, 'action.accounts');
        // アカウント紐付けを解除してスタッフ台帳の参照を残さない
        await supabaseAdmin
            .from('staffs')
            .update({ user_id: null })
            .eq('organization_id', orgId)
            .eq('user_id', targetId)
            .is('deleted_at', null);
    } else {
        const { error } = await supabaseAdmin
            .from('invitations')
            .delete()
            .eq('id', targetId)
            .eq('organization_id', orgId);
        if (error) throw sanitizeDbError(error, 'action.accounts');
    }
    await recordAuditEvent({ organizationId: orgId, actorId: callerId, action: status === 'active' ? 'account.remove' : 'account.invitation_revoke', resourceType: 'account', resourceId: targetId });
    return { success: true };
}

export async function getOrgRoles(orgId: string): Promise<{ id: string; name: string; color: string | null; is_preset: boolean }[]> {
    const user = await getAuthedUser();
    const { data: member, error } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .single();
    if (error || !member) throw new Error('アクセス権がありません');
    const { data, error: rolesError } = await supabaseAdmin
        .from('organization_roles')
        .select('id, name, color, is_preset')
        .eq('organization_id', orgId)
        .order('is_preset', { ascending: false });
    if (rolesError) throw new Error('ロール一覧を取得できませんでした');
    return data ?? [];
}

export async function updateMemberRoles(orgId: string, targetUserId: string, roleIds: string[]): Promise<void> {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    void isOwner; // used for audit; permission already checked
    const { data: targetMember } = await supabaseAdmin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', targetUserId).single();
    if (!targetMember) throw new Error('対象のメンバーが見つかりません');
    await assertRoleManagerRemains(orgId, { replacedMemberRoles: { userId: targetUserId, roleIds } });
    await supabaseAdmin.from('organization_member_roles').delete().eq('organization_id', orgId).eq('user_id', targetUserId);
    if (roleIds.length > 0) {
        const rows = roleIds.map(rid => ({ organization_id: orgId, user_id: targetUserId, role_id: rid }));
        const { error } = await supabaseAdmin.from('organization_member_roles').insert(rows);
        if (error) throw new Error('ロールの更新に失敗しました');
    }
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'account.roles_update', resourceType: 'account', resourceId: targetUserId, details: { roleIds } });
}
