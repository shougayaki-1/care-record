'use server';

import { supabaseAdmin, getAuthedUser, assertOrgRole } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { decryptGoogleToken } from '@/utils/googleTokenCrypto';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';

export async function updateOrganizationName(orgId: string, name: string) {
    const { userId } = await assertOrgRole(orgId, ['owner', 'manager']);
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 100) throw new Error('事業所名は1〜100文字で入力してください');
    const { error } = await supabaseAdmin.from('organizations').update({ name: normalized }).eq('id', orgId).is('deleted_at', null);
    if (error) throw new Error(error.message);
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'organization.update', resourceType: 'organization', resourceId: orgId, details: { fields: ['name'] } });
    return { success: true };
}

export async function updateOrganizationDriveFolder(orgId: string, folderId: string | null) {
    const { userId } = await assertOrgRole(orgId, ['owner', 'manager']);
    const normalized = folderId?.trim() || null;
    if (normalized && normalized.length > 255) throw new Error('フォルダIDが不正です');
    const { error } = await supabaseAdmin.from('organizations').update({ google_folder_id: normalized }).eq('id', orgId).is('deleted_at', null);
    if (error) throw new Error(error.message);
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: normalized ? 'integration.drive.connect' : 'integration.drive.disconnect', resourceType: 'organization', resourceId: orgId });
    return { success: true };
}

export async function disconnectGoogleCalendar(orgId: string) {
    const { userId } = await assertOrgRole(orgId, ['owner', 'manager']);
    const { data: org, error: readError } = await supabaseAdmin.from('organizations').select('google_refresh_token').eq('id', orgId).single();
    if (readError) throw new Error(readError.message);
    let revoked = false;
    if (org.google_refresh_token) {
        try {
            await getGoogleOAuthClient().revokeToken(decryptGoogleToken(org.google_refresh_token));
            revoked = true;
        } catch (error) {
            console.error('Google token revocation failed; local credentials will still be removed', error);
        }
    }
    const { error } = await supabaseAdmin.from('organizations').update({ google_calendar_id: null, google_refresh_token: null }).eq('id', orgId);
    if (error) throw new Error(error.message);
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'integration.calendar.disconnect', resourceType: 'organization', resourceId: orgId, details: { providerRevoked: revoked } });
    return { success: true, providerRevoked: revoked };
}

export async function deleteOrganization(orgId: string) {
    // 権限チェック: 呼び出し元がこの事業所の owner であることをセッションから検証
    const { userId } = await assertOrgRole(orgId, ['owner']);

    const { data: organization, error: orgReadError } = await supabaseAdmin
        .from('organizations')
        .select('retention_years')
        .eq('id', orgId)
        .single();
    if (orgReadError) throw new Error(orgReadError.message);
    const deletedAt = new Date();
    const retentionUntil = new Date(deletedAt);
    retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (organization.retention_years || 5));

    await recordAuditEvent({
        organizationId: orgId,
        actorId: userId,
        action: 'organization.soft_delete',
        resourceType: 'organization',
        resourceId: orgId,
        details: { retentionUntil: retentionUntil.toISOString() },
    });

    // 安全策: この事業所を「最後に開いた事業所」にしているユーザーの設定をクリア
    await supabaseAdmin.from('profiles')
        .update({ last_organization_id: null })
        .eq('last_organization_id', orgId);

    // 記録保持のため物理削除せず、利用不能化して全メンバーを外す。
    const { error } = await supabaseAdmin.from('organizations').update({
        deleted_at: deletedAt.toISOString(),
        deleted_by: userId,
        retention_until: retentionUntil.toISOString(),
    }).eq('id', orgId).is('deleted_at', null);
    if (error) throw new Error(error.message);

    const { error: memberError } = await supabaseAdmin
        .from('organization_members')
        .delete()
        .eq('organization_id', orgId);
    if (memberError) throw new Error(memberError.message);
    
    return { success: true };
}

export async function leaveOrganization(orgId: string) {
    // 脱退できるのは本人のみ。userId はセッションから取得する
    const { id: userId } = await getAuthedUser();

    const { data: members } = await supabaseAdmin.from('organization_members')
        .select('role, user_id').eq('organization_id', orgId);

    const owners = members?.filter(m => m.role === 'owner') || [];
    const me = members?.find(m => m.user_id === userId); 

    if (me?.role === 'owner' && owners.length <= 1 && (members?.length || 0) > 1) {
        throw new Error('あなたが唯一のオーナーです。脱退する前に他のメンバーにオーナー権限を譲渡するか、事業所を削除してください。');
    }

    const { error } = await supabaseAdmin.from('organization_members')
        .delete().eq('organization_id', orgId).eq('user_id', userId);
    
    if (error) throw new Error(error.message);
    
    // プロフィールのlast_organization_idもクリア
    await supabaseAdmin.from('profiles')
        .update({ last_organization_id: null })
        .eq('id', userId)
        .eq('last_organization_id', orgId);

    return { success: true };
}

export async function transferOwner(orgId: string, newOwnerId: string) {
    // 譲渡できるのは現 owner 本人のみ。現 owner はセッションから取得する
    const { userId: currentOwnerId } = await assertOrgRole(orgId, ['owner']);
    if (newOwnerId === currentOwnerId) throw new Error('譲渡先が不正です');

    // 譲渡先が同じ事業所のメンバーであることを確認
    const { data: target } = await supabaseAdmin.from('organization_members')
        .select('user_id').eq('organization_id', orgId).eq('user_id', newOwnerId).single();
    if (!target) throw new Error('譲渡先がこの事業所のメンバーではありません');

    // トランザクション的に処理
    const { error: error1 } = await supabaseAdmin.from('organization_members')
        .update({ role: 'owner' }).eq('organization_id', orgId).eq('user_id', newOwnerId);
    if (error1) throw error1;

    const { error: error2 } = await supabaseAdmin.from('organization_members')
        .update({ role: 'manager' }).eq('organization_id', orgId).eq('user_id', currentOwnerId);
    if (error2) throw error2;

    return { success: true };
}

export async function getAuditLogs(orgId: string) {
    await assertOrgRole(orgId, ['owner', 'manager']);
    // SQLで profiles への FK を貼ったので結合可能になります
    const { data, error } = await supabaseAdmin
        .from('audit_events')
        .select('*, profiles:actor_id(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100);
    
    if (error) throw new Error(error.message);
    return data;
}

export async function addAuditLog(params: { orgId: string, action: string, target?: string, details?: Record<string, unknown> }) {
    // actor はセッションから取得し、当該事業所のメンバーであることを検証（ログ偽造防止）
    const { userId } = await assertOrgRole(params.orgId);
    await recordAuditEvent({
        organizationId: params.orgId,
        actorId: userId,
        action: params.action,
        resourceType: 'legacy',
        resourceId: params.target,
        details: params.details,
    });
}
