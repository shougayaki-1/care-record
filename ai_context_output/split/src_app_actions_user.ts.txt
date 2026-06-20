'use server';

import { sanitizeDbError } from '@/utils/errors';

import { randomUUID } from 'crypto';
import { supabaseAdmin, createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';

export async function updateOwnProfile(name: string, agreeToTerms = false) {
    const { id: userId } = await getAuthedUser();
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 100) throw new Error('名前は1〜100文字で入力してください');
    const values: Record<string, unknown> = { id: userId, name: normalized };
    if (agreeToTerms) Object.assign(values, { is_agreed: true, agreed_at: new Date().toISOString() });
    const { error } = await supabaseAdmin.from('profiles').upsert(values);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function acceptCurrentTerms() {
    const { id: userId } = await getAuthedUser();
    const { error } = await supabaseAdmin.from('profiles').update({ is_agreed: true, agreed_at: new Date().toISOString() }).eq('id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function setLastOrganization(organizationId: string) {
    const { id: userId } = await getAuthedUser();
    const { data: member } = await supabaseAdmin.from('organization_members').select('id').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
    if (!member) throw new Error('この事業所へのアクセス権がありません');
    const { error } = await supabaseAdmin.from('profiles').update({ last_organization_id: organizationId }).eq('id', userId);
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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPEG、PNG、WebP形式の画像を選択してください');
    if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('画像は5MB以下にしてください');
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const path = `${userId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const { data } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);
    const { error } = await supabaseAdmin.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { avatarUrl: data.publicUrl };
}

export async function markNotificationRead(notificationId: string) {
    const { id: userId } = await getAuthedUser();
    const { error } = await supabaseAdmin.from('notifications').update({ is_read: true }).eq('id', notificationId).eq('user_id', userId);
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}

export async function deleteUserAccount() {
    // 退会できるのは本人のみ。対象 userId はセッションから取得する
    const user = await getAuthedUser();
    const userId = user.id;
    await recordAuditEvent({ organizationId: null, actorId: userId, action: 'account.self_delete_request', resourceType: 'account', resourceId: userId, sessionId: user.sessionId });
    const now = new Date().toISOString();
    const { error: requestError } = await supabaseAdmin.from('user_deletion_requests').insert({
        user_id: userId, retention_basis: '法令・契約上必要な記録と監査証跡を保全後、承認手順により消去',
    });
    if (requestError) throw sanitizeDbError(requestError, 'action.user');
    const { error: profileError } = await supabaseAdmin.from('profiles').update({
        deleted_at: now, deletion_reason: '本人による退会申請', last_organization_id: null,
    }).eq('id', userId);
    if (profileError) throw sanitizeDbError(profileError, 'action.user');
    await supabaseAdmin.from('organization_members').delete().eq('user_id', userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    if (error) throw sanitizeDbError(error, 'action.user');
    return { success: true };
}
