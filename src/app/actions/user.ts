'use server';

import { sanitizeDbError, UserFacingError, withSafeError } from '@/utils/errors';

import { randomUUID } from 'crypto';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { serviceRoleForAuthManagement } from '@/utils/supabase/serviceRole';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { sanitizeUploadedImage } from '@/utils/uploadSecurity';
import { z } from 'zod';

const supabaseAdmin = serviceRoleForAuthManagement();

export async function updateOwnProfile(name: string, agreeToTerms = false) {
    const { id: userId } = await getAuthedUser();
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 100) throw new Error('名前は1〜100文字で入力してください');
    const values: { id: string; name: string; is_agreed?: boolean; agreed_at?: string } = { id: userId, name: normalized };
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
    return withSafeError('markNotificationRead', async () => {
        const { id: userId } = await getAuthedUser();
        if (!z.uuid().safeParse(notificationId).success) throw new UserFacingError('通知の指定が不正です');
        const sessionClient = await createSessionClient();
        // The DB trigger uses DB time and preserves the first read timestamp.
        const { data, error } = await sessionClient.from('notifications').update({ is_read: true })
            .eq('id', notificationId).eq('user_id', userId).select('read_at').maybeSingle();
        if (error) throw sanitizeDbError(new Error('notification_read_failed'), 'notification.read');
        if (!data?.read_at) throw new UserFacingError('通知が見つかりません。通知一覧を開き直してください。');
        return { success: true, readAt: data.read_at };
    });
}

export async function deleteUserAccount(reauthToken: string) {
    return withSafeError('deleteUserAccount', async () => {
        // 本人・セッション・用途・期限・一回限りの証明はRPCでも原子的に検証する。
        const user = await getAuthedUser();
        const userId = user.id;
        if (!reauthToken) throw new UserFacingError('この操作には再認証が必要です');
        const sessionClient = await createSessionClient();
        const { error: requestError } = await sessionClient.rpc('request_own_account_deletion', {
            p_retention_basis: '法令・契約上必要な記録と監査証跡を保全後、承認手順により消去',
            p_reauth_token: reauthToken,
        });
        if (requestError) throw sanitizeDbError(requestError, 'action.user');
        await recordAuditEvent({ organizationId: null, actorId: userId, action: 'account.self_delete_request', resourceType: 'account', resourceId: userId, sessionId: user.sessionId });
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
        if (error) throw sanitizeDbError(error, 'action.user');
        return { success: true };
    });
}
