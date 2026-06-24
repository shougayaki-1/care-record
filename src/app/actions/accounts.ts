'use server';

import { sanitizeDbError } from '@/utils/errors';

import { randomUUID } from 'crypto';
import { supabaseAdmin, getAuthedUser, assertOrgRole, createSessionClient } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';

const VALID_ROLES = ['owner', 'manager', 'staff'] as const;
type Role = (typeof VALID_ROLES)[number];

type MemberRow = { user_id: string; role: string };

export type AccountOverviewItem = {
    id: string;
    name: string;
    role: Role;
    status: 'active' | 'invited';
    invitation_code?: string;
};

export async function getAccountOverview(orgId: string): Promise<{ currentUserId: string; accounts: AccountOverviewItem[] }> {
    const { userId, role: actorRole } = await assertOrgRole(orgId, ['owner', 'manager']);
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
    const { data: profiles, error: profilesError } = memberIds.length
        ? await supabaseAdmin.from('profiles').select('id, name').in('id', memberIds)
        : { data: [], error: null };
    if (profilesError) throw new Error('プロフィール情報を取得できませんでした');
    const profileNames = new Map((profiles || []).map((profile) => [profile.id, profile.name]));

    const accounts: AccountOverviewItem[] = memberRows.map((member) => ({
        id: member.user_id,
        name: profileNames.get(member.user_id) || '名前未設定',
        role: VALID_ROLES.includes(member.role as Role) ? member.role as Role : 'staff',
        status: 'active',
    }));
    for (const invitation of invitations || []) {
        const invitationRole = ['manager', 'staff'].includes(invitation.role) ? invitation.role as Role : 'staff';
        accounts.push({
            id: invitation.id,
            name: invitation.target_name || '名前未設定',
            role: invitationRole,
            status: 'invited',
            ...(actorRole === 'owner' ? { invitation_code: invitation.code } : {}),
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
export async function createInvitation(orgId: string, params: { targetName?: string; role: string }) {
    const { userId } = await assertOrgRole(orgId, ['owner']);

    // 招待で付与できるのは manager / staff のみ（owner は譲渡フローで扱う）
    if (!['manager', 'staff'].includes(params.role)) {
        throw new Error('指定された権限では招待できません');
    }

    const code = randomUUID().slice(0, 8);
    const { error } = await supabaseAdmin.from('invitations').insert({
        organization_id: orgId,
        code,
        created_by: userId,
        target_name: params.targetName || null,
        role: params.role,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) throw sanitizeDbError(error, 'action.accounts');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'account.invitation_create', resourceType: 'invitation', details: { role: params.role } });
    return { success: true, code };
}

/**
 * メンバー/招待のロールを変更する。owner のみ。
 * 最後の owner の降格はサーバ側でも拒否する。
 */
export async function updateAccountRole(
    orgId: string,
    params: { targetId: string; status: 'active' | 'invited'; newRole: string }
) {
    const { userId } = await assertOrgRole(orgId, ['owner']);
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
        // 他メンバーの除名 / 招待取消は owner のみ
        await assertOrgRole(orgId, ['owner']);
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
