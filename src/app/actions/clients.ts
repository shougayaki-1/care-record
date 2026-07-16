'use server';

import { sanitizeDbError, UserFacingError, withSafeError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import type { SupabaseClient } from '@supabase/supabase-js';

async function assertClientOrg(supabase: SupabaseClient, clientId: string, organizationId: string) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, archived_at, deleted_at')
    .eq('id', clientId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error || !data || data.deleted_at) throw new Error('利用者が見つかりません');
  return data;
}

function normalizeName(name: string) {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 100) {
    throw new Error('利用者名は1〜100文字で入力してください');
  }
  return normalized;
}

export async function createClient(organizationId: string, name: string) {
  return withSafeError('createClient', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    const { data, error } = await supabase
      .from('clients')
      .insert({ organization_id: organizationId, name: normalizeName(name) })
      .select('id, name, created_at, archived_at')
      .single();
    if (error || !data) throw new Error(error?.message || '利用者を作成できませんでした');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'client.create', resourceType: 'client', resourceId: data.id });
    return data;
  });
}

export async function updateClientName(organizationId: string, clientId: string, name: string) {
  return withSafeError('updateClientName', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    await assertClientOrg(supabase, clientId, organizationId);
    const normalized = normalizeName(name);
    const { error } = await supabase.from('clients').update({ name: normalized }).eq('id', clientId).eq('organization_id', organizationId);
    if (error) throw sanitizeDbError(error, 'action.clients');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'client.rename', resourceType: 'client', resourceId: clientId });
    return { success: true, name: normalized };
  });
}

export async function setClientArchived(organizationId: string, clientId: string, archived: boolean) {
  return withSafeError('setClientArchived', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    await assertClientOrg(supabase, clientId, organizationId);
    const { error } = await supabase.from('clients').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', clientId).eq('organization_id', organizationId);
    if (error) throw sanitizeDbError(error, 'action.clients');
    await recordAuditEvent({
      organizationId,
      actorId: userId,
      action: archived ? 'client.archive' : 'client.restore',
      resourceType: 'client',
      resourceId: clientId,
    });
    return { success: true };
  });
}

export async function softDeleteClient(organizationId: string, clientId: string, reason: string) {
  return withSafeError('softDeleteClient', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    const client = await assertClientOrg(supabase, clientId, organizationId);
    if (!client.archived_at) throw new UserFacingError('完全削除の前に利用者をアーカイブしてください');
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 2 || normalizedReason.length > 500) throw new Error('削除理由を2〜500文字で入力してください');
    const { data: org } = await supabase.from('organizations').select('retention_years').eq('id', organizationId).single();
    const deletedAt = new Date();
    const retentionUntil = new Date(deletedAt);
    retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (org?.retention_years || 5));
    const { error } = await supabase.from('clients').update({
      deleted_at: deletedAt.toISOString(),
      deleted_by: userId,
      deletion_reason: normalizedReason,
      retention_until: retentionUntil.toISOString(),
    }).eq('id', clientId).eq('organization_id', organizationId).is('deleted_at', null);
    if (error) throw sanitizeDbError(error, 'action.clients');
    await recordAuditEvent({
      organizationId,
      actorId: userId,
      action: 'client.soft_delete',
      resourceType: 'client',
      resourceId: clientId,
      details: { reason: normalizedReason, retentionUntil: retentionUntil.toISOString() },
    });
    return { success: true, retentionUntil: retentionUntil.toISOString() };
  });
}

export async function saveClientForm(organizationId: string, clientId: string, schema: unknown[]) {
  return withSafeError('saveClientForm', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    await assertClientOrg(supabase, clientId, organizationId);
    if (!Array.isArray(schema) || schema.length > 200 || JSON.stringify(schema).length > 1_000_000) {
      throw new Error('フォーム設定が不正、または大きすぎます');
    }
    const ids = schema.map((item) => typeof item === 'object' && item !== null && 'id' in item ? String(item.id) : '');
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('フォーム項目IDが不正または重複しています');

    const { error } = await supabase.rpc('upsert_client_form_authorized', {
      p_organization_id: organizationId,
      p_client_id: clientId,
      p_schema: schema,
    });
    if (error) throw sanitizeDbError(error, 'action.clients');
    await recordAuditEvent({
      organizationId,
      actorId: userId,
      action: 'client.form_update',
      resourceType: 'client',
      resourceId: clientId,
      details: { itemCount: schema.length },
    });
    return { success: true };
  });
}

export async function saveClientAssignments(
  organizationId: string,
  clientId: string,
  staffIds: string[],
  distancesByStaffId: Record<string, number> = {},
) {
  return withSafeError('saveClientAssignments', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    await assertClientOrg(supabase, clientId, organizationId);
    if (staffIds.length > 200) throw new UserFacingError('担当者数が多すぎます');
    const uniqueStaffIds = Array.from(new Set(staffIds.filter(Boolean)));
    const distances = Object.fromEntries(uniqueStaffIds.map((staffId) => [
      staffId,
      Math.min(Math.max(Number(distancesByStaffId[staffId] || 0), 0), 1000),
    ]));
    const { error } = await supabase.rpc('replace_client_assignments_authorized', {
      p_organization_id: organizationId,
      p_client_id: clientId,
      p_staff_ids: uniqueStaffIds,
      p_distances: distances,
    });
    if (error) throw sanitizeDbError(error, 'action.clients');
    await recordAuditEvent({
      organizationId,
      actorId: userId,
      action: 'client.assignments_update',
      resourceType: 'client',
      resourceId: clientId,
      details: { assignmentCount: uniqueStaffIds.length },
    });
    return { success: true };
  });
}

export async function updateClientGoogleLink(
  organizationId: string,
  clientId: string,
  values: { folderId?: string | null; templateId?: string | null },
) {
  return withSafeError('updateClientGoogleLink', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    await assertClientOrg(supabase, clientId, organizationId);
    const update: Record<string, string | null> = {};
    if ('folderId' in values) update.google_folder_id = values.folderId?.trim() || null;
    if ('templateId' in values) update.google_template_id = values.templateId?.trim() || null;
    if (Object.keys(update).length === 0) throw new UserFacingError('更新内容がありません');
    const { error } = await supabase.from('clients').update(update).eq('id', clientId).eq('organization_id', organizationId);
    if (error) throw sanitizeDbError(error, 'action.clients');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'client.google_link_update', resourceType: 'client', resourceId: clientId });
    return { success: true };
  });
}

export type AssignmentPermissionHint = {
  staffId: string;
  userId: string | null;
  canCreateAllRecords: boolean;
  roleNames: string[];
};

export async function getClientAssignmentPermissionHints(
  organizationId: string,
  clientId: string,
): Promise<AssignmentPermissionHint[]> {
  return withSafeError('getClientAssignmentPermissionHints', async () => {
    await assertOrgPermission(organizationId, 'clients');
    const supabase = await createSessionClient();
    await assertClientOrg(supabase, clientId, organizationId);
    const { data, error } = await supabase.rpc('get_client_assignment_permission_hints_authorized', {
      p_organization_id: organizationId,
      p_client_id: clientId,
    });
    if (error) throw sanitizeDbError(error, 'action.clients');
    return ((data ?? []) as Array<{ staff_id: string; user_id: string | null; can_create_all_records: boolean; role_names: string[] }>).map((row) => ({
      staffId: row.staff_id,
      userId: row.user_id,
      canCreateAllRecords: row.can_create_all_records,
      roleNames: row.role_names ?? [],
    }));
  });
}
