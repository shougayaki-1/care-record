'use server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOrgMember } from '@/utils/authCheck';
import { ActionResponse } from '@/types';

export async function createStaffDirectly(params: {
    email: string; password: string; name: string;
    organizationId: string; assignedClientIds: string[];
}): Promise<ActionResponse<{ userId: string }>> {
    const { email, password, name, organizationId, assignedClientIds } = params;

    try {
        // 認可チェック (スタッフの作成は、manager以上の権限が必要です)
        await requireOrgMember(organizationId, 'manager');

        // 1. Authユーザー作成
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email, password, email_confirm: true
        });
        if (authError || !authData.user) throw new Error(authError?.message || '作成失敗');
        const userId = authData.user.id;

        // 2. プロフィール作成
        await supabaseAdmin.from('profiles').insert({
            id: userId,
            name: name,
            last_organization_id: organizationId
        });

        // 3. 組織メンバーに追加
        await supabaseAdmin.from('organization_members').insert({
            organization_id: organizationId,
            user_id: userId,
            role: 'staff'
        });

        // 4. 担当割り当て
        if (assignedClientIds.length > 0) {
            const assignments = assignedClientIds.map(clientId => ({
                helper_id: userId, client_id: clientId
            }));
            await supabaseAdmin.from('assignments').insert(assignments);
        }

        return { status: 'success', data: { userId } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}