'use server';

import { sanitizeDbError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, assertOrgPermission, supabaseAdmin } from '@/utils/supabase/auth';

async function assertClientOrg(clientId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
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
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  const { data, error } = await supabaseAdmin
    .from('clients')
    .insert({ organization_id: organizationId, name: normalizeName(name) })
    .select('id, name, created_at, archived_at')
    .single();
  if (error || !data) throw new Error(error?.message || '利用者を作成できませんでした');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'client.create', resourceType: 'client', resourceId: data.id });
  return data;
}

export async function updateClientName(organizationId: string, clientId: string, name: string) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  await assertClientOrg(clientId, organizationId);
  const normalized = normalizeName(name);
  const { error } = await supabaseAdmin.from('clients').update({ name: normalized }).eq('id', clientId);
  if (error) throw sanitizeDbError(error, 'action.clients');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'client.rename', resourceType: 'client', resourceId: clientId });
  return { success: true, name: normalized };
}

export async function setClientArchived(organizationId: string, clientId: string, archived: boolean) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  await assertClientOrg(clientId, organizationId);
  const { error } = await supabaseAdmin.from('clients').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', clientId);
  if (error) throw sanitizeDbError(error, 'action.clients');
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: archived ? 'client.archive' : 'client.restore',
    resourceType: 'client',
    resourceId: clientId,
  });
  return { success: true };
}

export async function softDeleteClient(organizationId: string, clientId: string, reason: string) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  const client = await assertClientOrg(clientId, organizationId);
  if (!client.archived_at) throw new Error('完全削除の前に利用者をアーカイブしてください');
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 2 || normalizedReason.length > 500) throw new Error('削除理由を2〜500文字で入力してください');
  const { data: org } = await supabaseAdmin.from('organizations').select('retention_years').eq('id', organizationId).single();
  const deletedAt = new Date();
  const retentionUntil = new Date(deletedAt);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (org?.retention_years || 5));
  const { error } = await supabaseAdmin.from('clients').update({
    deleted_at: deletedAt.toISOString(),
    deleted_by: userId,
    deletion_reason: normalizedReason,
    retention_until: retentionUntil.toISOString(),
  }).eq('id', clientId).is('deleted_at', null);
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
}

export async function saveClientForm(organizationId: string, clientId: string, schema: unknown[]) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  await assertClientOrg(clientId, organizationId);
  if (!Array.isArray(schema) || schema.length > 200 || JSON.stringify(schema).length > 1_000_000) {
    throw new Error('フォーム設定が不正、または大きすぎます');
  }
  const ids = schema.map((item) => typeof item === 'object' && item !== null && 'id' in item ? String(item.id) : '');
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error('フォーム項目IDが不正または重複しています');

  const { data: existing } = await supabaseAdmin.from('form_templates').select('id').eq('client_id', clientId).maybeSingle();
  const query = existing
    ? supabaseAdmin.from('form_templates').update({ schema, updated_at: new Date().toISOString() }).eq('client_id', clientId)
    : supabaseAdmin.from('form_templates').insert({ client_id: clientId, schema });
  const { error } = await query;
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
}

export async function saveClientAssignments(
  organizationId: string,
  clientId: string,
  staffIds: string[],
  distancesByStaffId: Record<string, number> = {},
) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  await assertClientOrg(clientId, organizationId);
  if (staffIds.length > 200) throw new Error('担当者数が多すぎます');
  const uniqueStaffIds = Array.from(new Set(staffIds.filter(Boolean)));
  const { data: staffs, error: staffsError } = uniqueStaffIds.length > 0
    ? await supabaseAdmin
      .from('staffs')
      .select('id, user_id')
      .eq('organization_id', organizationId)
      .in('id', uniqueStaffIds)
      .is('archived_at', null)
      .is('deleted_at', null)
    : { data: [], error: null };
  if (staffsError) throw new Error(staffsError.message);
  if ((staffs || []).length !== uniqueStaffIds.length) throw new Error('事業所外または無効なスタッフが含まれています');

  const { error: deleteError } = await supabaseAdmin.from('assignments').delete().eq('client_id', clientId);
  if (deleteError) throw new Error(deleteError.message);
  if ((staffs || []).length > 0) {
    const { error } = await supabaseAdmin.from('assignments').insert((staffs || []).map((staff) => ({
      client_id: clientId,
      staff_id: staff.id,
      // ログインユーザーの利用者アクセス制御は従来どおり helper_id でも維持する。
      helper_id: staff.user_id,
      ghost_staff_id: null,
      round_trip_distance_km: Math.min(Math.max(Number(distancesByStaffId[staff.id] || 0), 0), 1000),
    })));
    if (error) throw sanitizeDbError(error, 'action.clients');
  }
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'client.assignments_update',
    resourceType: 'client',
    resourceId: clientId,
    details: { assignmentCount: uniqueStaffIds.length },
  });
  return { success: true };
}

export async function updateClientGoogleLink(
  organizationId: string,
  clientId: string,
  values: { folderId?: string | null; templateId?: string | null },
) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  await assertClientOrg(clientId, organizationId);
  const update: Record<string, string | null> = {};
  if ('folderId' in values) update.google_folder_id = values.folderId?.trim() || null;
  if ('templateId' in values) update.google_template_id = values.templateId?.trim() || null;
  if (Object.keys(update).length === 0) throw new Error('更新内容がありません');
  const { error } = await supabaseAdmin.from('clients').update(update).eq('id', clientId);
  if (error) throw sanitizeDbError(error, 'action.clients');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'client.google_link_update', resourceType: 'client', resourceId: clientId });
  return { success: true };
}
