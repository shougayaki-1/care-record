'use server';

import { sanitizeDbError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, assertOrgPermission, supabaseAdmin } from '@/utils/supabase/auth';

const EMPLOYMENT_TYPES = ['常勤', '非常勤'] as const;
const WORK_STYLES = ['兼務', '専従'] as const;

type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
type WorkStyle = (typeof WORK_STYLES)[number];

function normalizeChoice<T extends readonly string[]>(value: string, allowedValues: T, label: string): T[number] {
  if (!allowedValues.includes(value)) throw new Error(`${label}を選択してください`);
  return value as T[number];
}

function normalizeStaffInput(name: string, positions: string[], employmentType: string, workStyle: string) {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 100) throw new Error('スタッフ名は1〜100文字で入力してください');
  const normalizedPositions = Array.from(new Set(positions.map((item) => item.trim()).filter(Boolean)));
  if (normalizedPositions.length > 20 || normalizedPositions.some((item) => item.length > 50)) throw new Error('役職の入力が多すぎるか長すぎます');
  return {
    name: normalizedName,
    positions: normalizedPositions,
    employment_type: normalizeChoice(employmentType, EMPLOYMENT_TYPES, '雇用形態') as EmploymentType,
    work_style: normalizeChoice(workStyle, WORK_STYLES, '専従・兼務') as WorkStyle,
  };
}

async function assertStaffOrg(staffId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin.from('staffs').select('id, archived_at, deleted_at').eq('id', staffId).eq('organization_id', organizationId).maybeSingle();
  if (error || !data || data.deleted_at) throw new Error('スタッフが見つかりません');
  return data;
}

async function validateLinkedUser(organizationId: string, linkedUserId: string | null, excludeStaffId?: string | null) {
  if (!linkedUserId) return;
  const { data } = await supabaseAdmin.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('user_id', linkedUserId).maybeSingle();
  if (!data) throw new Error('事業所外のアカウントは紐付けできません');
  // 同一アカウントが別スタッフに既紐付きでないか確認（更新時は自分自身を除外）
  let dupeQuery = supabaseAdmin.from('staffs').select('id').eq('organization_id', organizationId).eq('user_id', linkedUserId).is('deleted_at', null);
  if (excludeStaffId) dupeQuery = dupeQuery.neq('id', excludeStaffId);
  const { data: existing } = await dupeQuery.maybeSingle();
  if (existing) throw new Error('このアカウントはすでに別のスタッフに紐付けられています');
}

export async function saveStaff(
  organizationId: string,
  values: {
    staffId?: string | null;
    name: string;
    positions: string[];
    employmentType: string;
    workStyle: string;
    linkedUserId?: string | null;
  },
) {
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
  const normalized = normalizeStaffInput(values.name, values.positions, values.employmentType, values.workStyle);
  const linkedUserId = values.linkedUserId || null;
  await validateLinkedUser(organizationId, linkedUserId, values.staffId);

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
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
  await assertStaffOrg(staffId, organizationId);
  const { error } = await supabaseAdmin.from('staffs').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', staffId);
  if (error) throw sanitizeDbError(error, 'action.staffs');
  await recordAuditEvent({ organizationId, actorId: userId, action: archived ? 'staff.archive' : 'staff.restore', resourceType: 'staff', resourceId: staffId });
  return { success: true };
}

export async function softDeleteStaff(organizationId: string, staffId: string, reason: string) {
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
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
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
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

export type StaffPositionPreset = {
  id: string;
  name: string;
  sort_order: number | null;
};

export async function getStaffPositionPresets(organizationId: string): Promise<StaffPositionPreset[]> {
  await assertOrgRole(organizationId);
  const { data, error } = await supabaseAdmin
    .from('staff_position_presets')
    .select('id, name, sort_order')
    .eq('organization_id', organizationId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw sanitizeDbError(error, 'action.staffs');
  return (data ?? []) as StaffPositionPreset[];
}

export async function saveStaffPositionPreset(organizationId: string, name: string) {
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 50) throw new Error('役職名は1〜50文字で入力してください');
  const { count } = await supabaseAdmin
    .from('staff_position_presets')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);
  const { data, error } = await supabaseAdmin
    .from('staff_position_presets')
    .insert({ organization_id: organizationId, name: normalized, sort_order: count ?? 0 })
    .select('id')
    .single();
  if (error || !data) throw sanitizeDbError(error || new Error('役職プリセットを保存できませんでした'), 'action.staffs');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'staff_position_preset.create', resourceType: 'staff_position_preset', resourceId: data.id, details: { name: normalized } });
  return { success: true, id: data.id as string };
}

export async function deleteStaffPositionPreset(organizationId: string, presetId: string) {
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
  const { error } = await supabaseAdmin
    .from('staff_position_presets')
    .delete()
    .eq('id', presetId)
    .eq('organization_id', organizationId);
  if (error) throw sanitizeDbError(error, 'action.staffs');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'staff_position_preset.delete', resourceType: 'staff_position_preset', resourceId: presetId });
  return { success: true };
}
