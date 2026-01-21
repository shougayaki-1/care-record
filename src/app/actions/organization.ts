'use server';

import { createClient } from '@supabase/supabase-js';

// 管理者権限クライアント
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function deleteOrganization(orgId: string, userId: string) {
    // 権限チェック
    const { data: member } = await supabaseAdmin.from('organization_members')
        .select('role').eq('organization_id', orgId).eq('user_id', userId).single();
    
    if (member?.role !== 'owner') throw new Error('権限がありません');

    // 安全策: この事業所を「最後に開いた事業所」にしているユーザーの設定をクリア
    await supabaseAdmin.from('profiles')
        .update({ last_organization_id: null })
        .eq('last_organization_id', orgId);

    // 削除実行
    const { error } = await supabaseAdmin.from('organizations').delete().eq('id', orgId);
    if (error) throw new Error(error.message);
    
    return { success: true };
}

export async function leaveOrganization(orgId: string, userId: string) {
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

export async function transferOwner(orgId: string, currentOwnerId: string, newOwnerId: string) {
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
    // SQLで profiles への FK を貼ったので結合可能になります
    const { data, error } = await supabaseAdmin
        .from('audit_logs')
        .select('*, profiles:actor_id(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100);
    
    if (error) throw new Error(error.message);
    return data;
}

export async function addAuditLog(params: { orgId: string, userId: string, action: string, target?: string, details?: Record<string, unknown> }) {
    await supabaseAdmin.from('audit_logs').insert({
        organization_id: params.orgId,
        actor_id: params.userId,
        action_type: params.action,
        target_resource: params.target,
        details: params.details
    });
}