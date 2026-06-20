'use server';

import { sanitizeDbError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, supabaseAdmin } from '@/utils/supabase/auth';

function normalizeStaffInput(name: string, positions: string[]) {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 100) throw new Error('スタッフ名は1〜100文字で入力してください');
  const normalizedPositions = Array.from(new Set(positions.map((item) => item.trim()).filter(Boolean)));
  if (normalizedPositions.length > 20 || normalizedPositions.some((item) => item.length > 50)) throw new Error('役職の入力が多すぎるか長すぎます');
  return { name: normalizedName, positions: normalizedPositions };
}

async function assertStaffOrg(staffId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin.from('staffs').select('id, archived_at, deleted_at').eq('id', staffId).eq('organization_id', organizationId).maybeSingle();
  if (error || !data || data.deleted_at) throw new Error('スタッフが見つかりません');
  return data;
}

async function validateLinkedUser(organizationId: string, linkedUserId: string | null) {
  if (!linkedUserId) return;
  const { data } = await supabaseAdmin.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('user_id', linkedUserId).maybeSingle();
  if (!data) throw new Error('事業所外のアカウントは紐付けできません');
}

export async function saveStaff(
  organizationId: string,
  values: { staffId?: string | null; name: string; positions: string[]; linkedUserId?: string | null },
) {
  const { userId } = await assertOrgRole(organizationId, ['owner', 'manager']);
  const normalized = normalizeStaffInput(values.name, values.positions);
  const linkedUserId = values.linkedUserId || null;
  await validateLinkedUser(organizationId, linkedUserId);

  let staffId = values.staffId || null;
  if (staffId) {
    await assertStaffOrg(staffId, organizationId);
    const { error } = await supabaseAdmin.from('staffs').update({ ...normalized, user_id: linkedUserId }).eq('id', staffId);
    if (error) throw sanitizeDbError(error, 'action.staffs');
  } else {
    const { data, error } = await supabaseAdmin.from('staffs').insert({ organization_id: organizationId, ...normalized, user_id: linkedUserId }).select('id').single();
    if (error || !data) throw new Error(error?.message || 'スタッフを作成できませんでした');
    staffId = data.id;
  }
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: values.staffId ? 'staff.update' : 'staff.create',
    resourceType: 'staff',
    resourceId: staffId,
  });
  return { success: true, staffId };
}

export async function setStaffArchived(organizationId: string, staffId: string, archived: boolean) {
  const { userId } = await assertOrgRole(organizationId, ['owner', 'manager']);
  await assertStaffOrg(staffId, organizationId);
  const { error } = await supabaseAdmin.from('staffs').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', staffId);
  if (error) throw sanitizeDbError(error, 'action.staffs');
  await recordAuditEvent({ organizationId, actorId: userId, action: archived ? 'staff.archive' : 'staff.restore', resourceType: 'staff', resourceId: staffId });
  return { success: true };
}

export async function softDeleteStaff(organizationId: string, staffId: string, reason: string) {
  const { userId } = await assertOrgRole(organizationId, ['owner']);
  await assertStaffOrg(staffId, organizationId);
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 2 || normalizedReason.length > 500) throw new Error('削除理由を2〜500文字で入力してください');
  const { data: org } = await supabaseAdmin.from('organizations').select('retention_years').eq('id', organizationId).single();
  const now = new Date();
  const retentionUntil = new Date(now);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (org?.retention_years || 5));
  const { error } = await supabaseAdmin.from('staffs').update({
    deleted_at: now.toISOString(),
    deleted_by: userId,
    deletion_reason: normalizedReason,
    retention_until: retentionUntil.toISOString(),
  }).eq('id', staffId).is('deleted_at', null);
  if (error) throw sanitizeDbError(error, 'action.staffs');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'staff.soft_delete', resourceType: 'staff', resourceId: staffId, details: { reason: normalizedReason } });
  return { success: true };
}

export async function reorderStaffs(organizationId: string, staffIds: string[]) {
  const { userId } = await assertOrgRole(organizationId, ['owner', 'manager']);
  const ids = Array.from(new Set(staffIds.filter(Boolean)));
  if (ids.length !== staffIds.length || ids.length > 500) throw new Error('並び順が不正です');
  const { data } = await supabaseAdmin.from('staffs').select('id').eq('organization_id', organizationId).in('id', ids).is('deleted_at', null);
  if ((data || []).length !== ids.length) throw new Error('事業所外のスタッフが含まれています');
  for (let index = 0; index < ids.length; index += 1) {
    const { error } = await supabaseAdmin.from('staffs').update({ sort_order: index }).eq('id', ids[index]);
    if (error) throw sanitizeDbError(error, 'action.staffs');
  }
  await recordAuditEvent({ organizationId, actorId: userId, action: 'staff.reorder', resourceType: 'staff', details: { count: ids.length } });
  return { success: true };
}
