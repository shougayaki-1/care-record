'use server';

import { sanitizeDbError } from '@/utils/errors';

import { supabaseAdmin, getAuthedUser, assertOrgRole, assertOrgPermission, assertOwner } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { decryptGoogleToken } from '@/utils/googleTokenCrypto';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';
import { assertRoleManagerRemains } from '@/utils/supabase/roleSafety';
import { google } from 'googleapis';

export async function updateOrganizationName(orgId: string, name: string) {
    const { userId } = await assertOrgPermission(orgId, 'organization');
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 100) throw new Error('事業所名は1〜100文字で入力してください');
    const { error } = await supabaseAdmin.from('organizations').update({ name: normalized }).eq('id', orgId).is('deleted_at', null);
    if (error) throw sanitizeDbError(error, 'action.organization');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'organization.update', resourceType: 'organization', resourceId: orgId, details: { fields: ['name'] } });
    return { success: true };
}

export async function updateOrganizationDriveFolder(orgId: string, folderId: string | null) {
    const { userId } = await assertOrgPermission(orgId, 'integrations');
    const normalized = folderId?.trim() || null;
    if (normalized && normalized.length > 255) throw new Error('フォルダIDが不正です');
    const { error } = await supabaseAdmin.from('organizations').update({ google_folder_id: normalized }).eq('id', orgId).is('deleted_at', null);
    if (error) throw sanitizeDbError(error, 'action.organization');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: normalized ? 'integration.drive.connect' : 'integration.drive.disconnect', resourceType: 'organization', resourceId: orgId });
    return { success: true };
}

export async function disconnectGoogleCalendar(orgId: string) {
    const { userId } = await assertOrgPermission(orgId, 'integrations');
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
    if (error) throw sanitizeDbError(error, 'action.organization');
    await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'integration.calendar.disconnect', resourceType: 'organization', resourceId: orgId, details: { providerRevoked: revoked } });
    return { success: true, providerRevoked: revoked };
}

export async function deleteOrganization(orgId: string) {
    // 権限チェック: owner かつ organizationDelete 権限が必要
    const { userId, isOwner } = await assertOrgPermission(orgId, 'organizationDelete');
    if (!isOwner) throw new Error('事業所の削除はオーナーのみ実行できます');

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
    if (error) throw sanitizeDbError(error, 'action.organization');

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

    const me = members?.find(m => m.user_id === userId);
    if (!me) throw new Error('この事業所のメンバーではありません');

    const owners = members?.filter(m => m.role === 'owner') || [];

    if (me?.role === 'owner' && owners.length <= 1 && (members?.length || 0) > 1) {
        throw new Error('あなたが唯一のオーナーです。脱退する前に他のメンバーにオーナー権限を譲渡するか、事業所を削除してください。');
    }
    await assertRoleManagerRemains(orgId, { removedMemberId: userId });

    const { error } = await supabaseAdmin.from('organization_members')
        .delete().eq('organization_id', orgId).eq('user_id', userId);
    
    if (error) throw sanitizeDbError(error, 'action.organization');
    
    // プロフィールのlast_organization_idもクリア
    await supabaseAdmin.from('profiles')
        .update({ last_organization_id: null })
        .eq('id', userId)
        .eq('last_organization_id', orgId);

    return { success: true };
}

export async function transferOwner(orgId: string, newOwnerId: string) {
    // 譲渡できるのは現 owner 本人のみ。現 owner はセッションから取得する
    const { userId: currentOwnerId } = await assertOwner(orgId);
    await assertOrgPermission(orgId, 'ownerTransfer');

    // 両方の UPDATE を単一トランザクション内で原子的に実行する RPC を使用
    // 分割 UPDATE だと1件目成功・2件目失敗で2オーナー状態になりうるため
    const { error } = await supabaseAdmin.rpc('transfer_owner_atomic', {
        p_org_id: orgId,
        p_new_owner_id: newOwnerId,
        p_current_owner_id: currentOwnerId,
    });
    if (error?.message === 'invalid_transfer_target') throw new Error('譲渡先が不正です');
    if (error?.message === 'target_not_member') throw new Error('譲渡先がこの事業所のメンバーではありません');
    if (error) throw sanitizeDbError(error, 'action.organization');

    return { success: true };
}

export type AuditLogFilters = {
    from?: string | null; // ISO日時。これ以降
    to?: string | null;   // ISO日時。これ以前
    actionType?: string | null; // 前方一致（例: 'report.' で記録系のみ）
    outcome?: 'success' | 'failure' | null;
    limit?: number;
    offset?: number;
};

function applyAuditFilters<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T; like: (c: string, v: string) => T; eq: (c: string, v: string) => T }>(
    query: T,
    filters: AuditLogFilters,
): T {
    let q = query;
    if (filters.from) q = q.gte('created_at', filters.from);
    if (filters.to) q = q.lte('created_at', filters.to);
    if (filters.actionType) q = q.like('action_type', `${filters.actionType}%`);
    if (filters.outcome) q = q.eq('outcome', filters.outcome);
    return q;
}

export async function getAuditLogs(orgId: string, filters: AuditLogFilters = {}) {
    await assertOrgPermission(orgId, 'auditLogs');
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    // SQLで profiles への FK を貼ったので結合可能になります
    let query = supabaseAdmin
        .from('audit_events')
        .select('*, profiles:actor_id(name)')
        .eq('organization_id', orgId);
    query = applyAuditFilters(query as never, filters) as never;
    const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) throw sanitizeDbError(error, 'action.organization');
    return data;
}

/** 監査ログをCSV化して返す。監査エビデンス出力自体も監査記録する。 */
export async function exportAuditLogsCsv(orgId: string, filters: AuditLogFilters = {}): Promise<{ filename: string; csv: string }> {
    const { userId } = await assertOrgPermission(orgId, 'auditLogs');
    const EXPORT_CAP = 10000;
    let query = supabaseAdmin
        .from('audit_events')
        .select('created_at, action_type, resource_type, resource_id, outcome, actor_id, ip_hash, profiles:actor_id(name)')
        .eq('organization_id', orgId);
    query = applyAuditFilters(query as never, filters) as never;
    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(EXPORT_CAP);
    if (error) throw sanitizeDbError(error, 'action.organization');

    const rows = (data ?? []) as Array<Record<string, unknown> & { profiles?: { name?: string } | null }>;
    const header = ['日時', '操作者', '操作内容', '対象種別', '対象ID', '結果', 'IPハッシュ'];
    const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) => [
        r.created_at, r.profiles?.name ?? '', r.action_type, r.resource_type, r.resource_id ?? '', r.outcome, r.ip_hash ?? '',
    ].map(escape).join(','));
    const csv = '﻿' + [header.join(','), ...lines].join('\r\n'); // BOM付きでExcel互換

    await recordAuditEvent({
        organizationId: orgId,
        actorId: userId,
        action: 'audit.export',
        resourceType: 'audit',
        details: { count: rows.length, filters },
    });

    return { filename: `audit_${orgId}_${new Date().toISOString().slice(0, 10)}.csv`, csv };
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

export type CloudLogFilters = {
    from?: string | null;
    to?: string | null;
    severity?: string | null;
    text?: string | null;
    limit?: number;
};

export type CloudLogEntry = {
    timestamp: string;
    severity: string;
    logName: string;
    text: string;
};

export async function listCloudLogEntries(orgId: string, filters: CloudLogFilters = {}): Promise<CloudLogEntry[]> {
    await assertOrgPermission(orgId, 'auditLogs');
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error('GCP_PROJECT_ID が設定されていません');

    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/cloud-platform.read-only'] });
    const logging = google.logging({ version: 'v2', auth });
    const filterParts: string[] = [];
    if (filters.from) filterParts.push(`timestamp >= "${filters.from}"`);
    if (filters.to) filterParts.push(`timestamp <= "${filters.to}"`);
    if (filters.severity) filterParts.push(`severity >= ${filters.severity}`);
    if (filters.text?.trim()) filterParts.push(`textPayload:"${filters.text.trim().replace(/"/g, '\\"')}"`);
    const res = await logging.entries.list({
        requestBody: {
            resourceNames: [`projects/${projectId}`],
            filter: filterParts.join(' AND ') || undefined,
            orderBy: 'timestamp desc',
            pageSize: Math.min(Math.max(filters.limit ?? 100, 1), 200),
        },
    });
    return (res.data.entries ?? []).map((entry) => {
        const payload = entry.textPayload ?? (entry.jsonPayload ? JSON.stringify(entry.jsonPayload) : entry.protoPayload ? JSON.stringify(entry.protoPayload) : '');
        return {
            timestamp: entry.timestamp ?? '',
            severity: entry.severity ?? 'DEFAULT',
            logName: entry.logName ?? '',
            text: payload,
        };
    });
}
