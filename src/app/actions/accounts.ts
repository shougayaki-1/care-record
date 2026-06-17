'use server';

import { randomUUID } from 'crypto';
import { supabaseAdmin, getAuthedUser, assertOrgRole } from '@/utils/supabase/auth';

const VALID_ROLES = ['owner', 'manager', 'staff'] as const;
type Role = (typeof VALID_ROLES)[number];

type MemberRow = { user_id: string; role: string };

/**
 * 招待コードで事業所に参加する。
 * 招待の検証・ロール付与・使用済みフラグ更新をサーバ側(service role)で原子的に行う。
 * これにより organization_members への自己挿入(任意ロール化)を RLS で禁止できる。
 */
export async function acceptInvitation(code: string) {
    const { id: userId } = await getAuthedUser();
    if (!code?.trim()) throw new Error('招待コードが不正です');

    // 1. 未使用の招待を取得（コード一致 + is_used=false）
    const { data: invite, error: inviteError } = await supabaseAdmin
        .from('invitations')
        .select('id, organization_id, role, is_used, target_client_ids')
        .eq('code', code.trim())
        .eq('is_used', false)
        .single();
    if (inviteError || !invite) throw new Error('無効な招待コード、または既に使用されています');

    // 付与ロールは招待値を採用するが、想定外の値は staff に丸める
    const role = (['manager', 'staff'].includes(invite.role) ? invite.role : 'staff') as Role;

    // 2. 既にメンバーなら何もしない（再参加）
    const { data: existing } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', invite.organization_id)
        .eq('user_id', userId)
        .maybeSingle();

    if (!existing) {
        const { error: memberError } = await supabaseAdmin
            .from('organization_members')
            .insert({ organization_id: invite.organization_id, user_id: userId, role });
        if (memberError) throw new Error(memberError.message);
    }

    // 3. 招待を使用済みに（競合時の二重使用を避けるため is_used=false を条件に更新）
    await supabaseAdmin.from('invitations').update({ is_used: true }).eq('id', invite.id).eq('is_used', false);

    // 4. 担当割り当て
    const clientIds: string[] = invite.target_client_ids || [];
    if (clientIds.length > 0) {
        const assignments = clientIds.map((clientId) => ({ helper_id: userId, client_id: clientId }));
        await supabaseAdmin.from('assignments').insert(assignments);
    }

    // 5. 最後に開いた事業所を更新
    await supabaseAdmin.from('profiles').update({ last_organization_id: invite.organization_id }).eq('id', userId);

    return { success: true, organizationId: invite.organization_id, alreadyMember: !!existing };
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
    });
    if (error) throw new Error(error.message);
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
    await assertOrgRole(orgId, ['owner']);
    const { targetId, status, newRole } = params;
    if (!VALID_ROLES.includes(newRole as Role)) throw new Error('権限が不正です');

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
        if (error) throw new Error(error.message);
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
        if (error) throw new Error(error.message);
    }
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
        if (error) throw new Error(error.message);
    } else {
        const { error } = await supabaseAdmin
            .from('invitations')
            .delete()
            .eq('id', targetId)
            .eq('organization_id', orgId);
        if (error) throw new Error(error.message);
    }
    return { success: true };
}
