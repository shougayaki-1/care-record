'use server';

import { sanitizeDbError } from '@/utils/errors';

import { randomUUID } from 'crypto';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { serviceRoleForAuthManagement } from '@/utils/supabase/serviceRole';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { sanitizeUploadedImage } from '@/utils/uploadSecurity';

const supabaseAdmin = serviceRoleForAuthManagement();

export async function updateOwnProfile(name: string, agreeToTerms = false) {
    const { id: userId } = await getAuthedUser();
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 100) throw new Error('名前は1〜100文字で入力してください');
    const values: Record<string, unknown> = { id: userId, name: normalized };
    if (agreeToTerms) Object.assign(values, { is_agreed: true, agreed_at: new Date().toISOString() });
    const sessionClient = await createSessionClient();
    const { error } = await sessionClient.from('profiles').upsert(values);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function acceptCurrentTerms() {
    const { id: userId } = await getAuthedUser();
    const sessionClient = await createSessionClient();
    const { error } = await sessionClient.from('profiles').update({ is_agreed: true, agreed_at: new Date().toISOString() }).eq('id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function setLastOrganization(organizationId: string) {
    const { id: userId } = await getAuthedUser();
    const sessionClient = await createSessionClient();
    const { data: member } = await sessionClient.from('organization_members').select('id').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
    if (!member) throw new Error('この事業所へのアクセス権がありません');
    const { error } = await sessionClient.from('profiles').update({ last_organization_id: organizationId }).eq('id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function createOrganization(name: string) {
    await getAuthedUser();
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 100) throw new Error('事業所名は1〜100文字で入力してください');
    const sessionClient = await createSessionClient();
    const { data: organizationId, error } = await sessionClient.rpc('create_organization', { org_name: normalized });
    if (error || !organizationId) throw new Error(error?.message || '事業所を作成できませんでした');
    await setLastOrganization(String(organizationId));
    return { organizationId: String(organizationId) };
}

export async function uploadOwnAvatar(formData: FormData) {
    const { id: userId } = await getAuthedUser();
    const file = formData.get('avatar');
    if (!(file instanceof File)) throw new Error('画像を選択してください');
    const sanitized = await sanitizeUploadedImage(file);
    const path = `${userId}/${randomUUID()}.${sanitized.extension}`;
    const sessionClient = await createSessionClient();
    const { error: uploadError } = await sessionClient.storage.from('avatars').upload(path, sanitized.bytes, {
        contentType: sanitized.contentType,
        upsert: false,
        cacheControl: '3600',
    });
    if (uploadError) throw new Error(uploadError.message);
    const { data } = sessionClient.storage.from('avatars').getPublicUrl(path);
    const { error } = await sessionClient.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { avatarUrl: data.publicUrl };
}

export async function markNotificationRead(notificationId: string) {
    const { id: userId } = await getAuthedUser();
    const sessionClient = await createSessionClient();
    const { error } = await sessionClient.from('notifications').update({ is_read: true }).eq('id', notificationId).eq('user_id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function deleteUserAccount() {
    // 退会できるのは本人のみ。対象 userId はセッションから取得する
    const user = await getAuthedUser();
    const userId = user.id;
    await recordAuditEvent({ organizationId: null, actorId: userId, action: 'account.self_delete_request', resourceType: 'account', resourceId: userId, sessionId: user.sessionId });
    const sessionClient = await createSessionClient();
    const { error: requestError } = await sessionClient.rpc('request_own_account_deletion', {
        p_retention_basis: '法令・契約上必要な記録と監査証跡を保全後、承認手順により消去',
    });
    if (requestError) throw sanitizeDbError(requestError, 'action.user');
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}
