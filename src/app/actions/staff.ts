'use server';

import { supabaseAdmin, assertOrgPermission } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { validatePassword } from '@/utils/passwordPolicy';

export async function createStaffDirectly(params: {
    email: string; password: string; name: string;
    organizationId: string; assignedClientIds: string[];
}) {
    const { email, password, name, organizationId, assignedClientIds } = params;
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 100) throw new Error('氏名が不正です');
    const passwordResult = validatePassword(password);
    if (!passwordResult.ok) throw new Error(passwordResult.message);

    // 権限チェック: 呼び出し元がスタッフ管理権限を持つか検証
    const actor = await assertOrgPermission(organizationId, 'staffs');

    if (assignedClientIds.length > 0) {
        const { data: allowedClients } = await supabaseAdmin.from('clients').select('id')
            .eq('organization_id', organizationId).in('id', assignedClientIds).is('deleted_at', null);
        if ((allowedClients || []).length !== new Set(assignedClientIds).size) throw new Error('担当利用者が不正です');
    }

    // Authと業務DBは同一トランザクションにできないため、後続失敗時はAuthを補償削除する。
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email, password, email_confirm: true
    });
    if (authError || !authData.user) throw new Error(authError?.message || '作成失敗');
    const userId = authData.user.id;
    try {
        const { error: profileError } = await supabaseAdmin.from('profiles').insert({
            id: userId, name: normalizedName, last_organization_id: organizationId,
        });
        if (profileError) throw profileError;
        const { error: memberError } = await supabaseAdmin.from('organization_members').insert({
            organization_id: organizationId, user_id: userId, role: 'member',
        });
        if (memberError) throw memberError;
        if (assignedClientIds.length > 0) {
            const { error: assignmentError } = await supabaseAdmin.from('assignments').insert(
                assignedClientIds.map(clientId => ({ helper_id: userId, client_id: clientId }))
            );
            if (assignmentError) throw assignmentError;
        }
    } catch (error) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'account.staff_create', resourceType: 'account', resourceId: userId, outcome: 'failure' });
        throw error;
    }

    await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'account.staff_create', resourceType: 'account', resourceId: userId, details: { assignedClientCount: assignedClientIds.length } });

    return { success: true, userId };
}
