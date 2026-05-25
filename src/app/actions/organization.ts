'use server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOrgMember } from '@/utils/authCheck';
import { ActionResponse, AuditLogRow } from '@/types';

export async function deleteOrganization(orgId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
        // 認可チェック: 呼び出し元がownerであることを保証
        await requireOrgMember(orgId, 'owner');

        // 安全策: この事業所を「最後に開いた事業所」にしているユーザーの設定をクリア
        await supabaseAdmin.from('profiles')
            .update({ last_organization_id: null })
            .eq('last_organization_id', orgId);

        // 削除実行
        const { error } = await supabaseAdmin.from('organizations').delete().eq('id', orgId);
        if (error) throw new Error(error.message);
        
        return { status: 'success', data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}

export async function leaveOrganization(orgId: string, userId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
        // 認可チェック: ログイン確認、および操作ユーザーが本人であることを検証
        const callerUserId = await requireOrgMember(orgId);
        if (callerUserId !== userId) {
            throw new Error('他人の脱退処理を代理実行することはできません。');
        }

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

        return { status: 'success', data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}

export async function transferOwner(orgId: string, currentOwnerId: string, newOwnerId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
        // 認可チェック: オーナーのみこの操作が可能であることを確認
        const callerUserId = await requireOrgMember(orgId, 'owner');
        if (callerUserId !== currentOwnerId) {
            throw new Error('オーナー権限譲渡を実行する権利がありません。');
        }

        // トランザクション的に処理
        const { error: error1 } = await supabaseAdmin.from('organization_members')
            .update({ role: 'owner' }).eq('organization_id', orgId).eq('user_id', newOwnerId);
        if (error1) throw error1;

        const { error: error2 } = await supabaseAdmin.from('organization_members')
            .update({ role: 'manager' }).eq('organization_id', orgId).eq('user_id', currentOwnerId);
        if (error2) throw error2;

        return { status: 'success', data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}

export async function getAuditLogs(orgId: string): Promise<ActionResponse<AuditLogRow[]>> {
    try {
        // 認可チェック: 管理者(manager)以上のみ監査ログへのアクセスを許可します
        await requireOrgMember(orgId, 'manager');

        const { data, error } = await supabaseAdmin
            .from('audit_logs')
            .select('*, profiles:actor_id(name)')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false })
            .limit(100);
        
        if (error) throw new Error(error.message);

        const logs = data as unknown as AuditLogRow[];
        return { status: 'success', data: logs };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}

export async function addAuditLog(params: { orgId: string, userId: string, action: string, target?: string, details?: Record<string, unknown> }): Promise<ActionResponse<{ success: boolean }>> {
    try {
        // 認可チェック: 操作者本人がログインしていることを検証
        const callerUserId = await requireOrgMember(params.orgId);
        if (callerUserId !== params.userId) {
            throw new Error('ログを記録する権限がありません。');
        }

        const { error } = await supabaseAdmin.from('audit_logs').insert({
            organization_id: params.orgId,
            actor_id: params.userId,
            action_type: params.action,
            target_resource: params.target,
            details: params.details
        });

        if (error) throw error;
        return { status: 'success', data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}