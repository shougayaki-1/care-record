'use server';

import { sanitizeDbError, UserFacingError, withSafeError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import type { SupabaseClient } from '@supabase/supabase-js';

const EMPLOYMENT_TYPES = ['常勤', '非常勤'] as const;
const WORK_STYLES = ['兼務', '専従'] as const;

type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
type WorkStyle = (typeof WORK_STYLES)[number];

function normalizeChoice<T extends readonly string[]>(value: string, allowedValues: T, label: string): T[number] {
  if (!allowedValues.includes(value)) throw new UserFacingError(`${label}を選択してください`);
  return value as T[number];
}

async function normalizePositions(supabase: SupabaseClient, organizationId: string, positions: string[]): Promise<string[]> {
  const uniquePositions = Array.from(new Set(positions.map((item) => item.trim()).filter(Boolean)));
  if (uniquePositions.length > 20 || uniquePositions.some((item) => item.length > 50)) {
    throw new UserFacingError('役職の入力が多すぎるか長すぎます');
  }

  const { data, error } = await supabase
    .from('staff_position_presets')
    .select('name, sort_order')
    .eq('organization_id', organizationId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw sanitizeDbError(error, 'action.staffs');

  const selected = new Set(uniquePositions);
  const orderedPresetPositions = (data ?? [])
    .map((preset) => preset.name)
    .filter((name) => selected.has(name));
  const presetNames = new Set((data ?? []).map((preset) => preset.name));
  const customPositions = uniquePositions
    .filter((name) => !presetNames.has(name))
    .sort((a, b) => a.localeCompare(b, 'ja'));

  return [...orderedPresetPositions, ...customPositions];
}

async function normalizeStaffInput(supabase: SupabaseClient, organizationId: string, name: string, positions: string[], employmentType: string, workStyle: string) {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 100) throw new Error('スタッフ名は1〜100文字で入力してください');
  return {
    name: normalizedName,
    positions: await normalizePositions(supabase, organizationId, positions),
    employment_type: normalizeChoice(employmentType, EMPLOYMENT_TYPES, '雇用形態') as EmploymentType,
    work_style: normalizeChoice(workStyle, WORK_STYLES, '専従・兼務') as WorkStyle,
  };
}

async function assertStaffOrg(supabase: SupabaseClient, staffId: string, organizationId: string) {
  const { data, error } = await supabase.from('staffs').select('id, archived_at, deleted_at').eq('id', staffId).eq('organization_id', organizationId).maybeSingle();
  if (error || !data || data.deleted_at) throw new Error('スタッフが見つかりません');
  return data;
}

async function validateLinkedUser(supabase: SupabaseClient, organizationId: string, linkedUserId: string | null, excludeStaffId?: string | null) {
  if (!linkedUserId) return;
  const { data } = await supabase.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('user_id', linkedUserId).maybeSingle();
  if (!data) throw new UserFacingError('事業所外のアカウントは紐付けできません');
  // 同一アカウントが別スタッフに既紐付きでないか確認（更新時は自分自身を除外）
  let dupeQuery = supabase.from('staffs').select('id').eq('organization_id', organizationId).eq('user_id', linkedUserId).is('deleted_at', null);
  if (excludeStaffId) dupeQuery = dupeQuery.neq('id', excludeStaffId);
  const { data: existing } = await dupeQuery.maybeSingle();
  if (existing) throw new UserFacingError('このアカウントはすでに別のスタッフに紐付けられています');
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
  return withSafeError('saveStaff', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'staffs');
    const supabase = await createSessionClient();
    const normalized = await normalizeStaffInput(supabase, organizationId, values.name, values.positions, values.employmentType, values.workStyle);
    const linkedUserId = values.linkedUserId || null;
    await validateLinkedUser(supabase, organizationId, linkedUserId, values.staffId);

    let staffId = values.staffId || null;
    if (staffId) {
      await assertStaffOrg(supabase, staffId, organizationId);
      const { error } = await supabase.from('staffs').update({ ...normalized, user_id: linkedUserId }).eq('id', staffId).eq('organization_id', organizationId);
      if (error) throw sanitizeDbError(error, 'action.staffs');
    } else {
      const { data, error } = await supabase.from('staffs').insert({ organization_id: organizationId, ...normalized, user_id: linkedUserId }).select('id').single();
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
  });
}

export async function setStaffArchived(organizationId: string, staffId: string, archived: boolean) {
  return withSafeError('setStaffArchived', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'staffs');
    const supabase = await createSessionClient();
    await assertStaffOrg(supabase, staffId, organizationId);
    const { error } = await supabase.from('staffs').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', staffId).eq('organization_id', organizationId);
    if (error) throw sanitizeDbError(error, 'action.staffs');
    await recordAuditEvent({ organizationId, actorId: userId, action: archived ? 'staff.archive' : 'staff.restore', resourceType: 'staff', resourceId: staffId });
    return { success: true };
  });
}

export async function softDeleteStaff(organizationId: string, staffId: string, reason: string) {
  return withSafeError('softDeleteStaff', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'staffs');
    const supabase = await createSessionClient();
    await assertStaffOrg(supabase, staffId, organizationId);
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 2 || normalizedReason.length > 500) throw new Error('削除理由を2〜500文字で入力してください');
    const { data: org } = await supabase.from('organizations').select('retention_years').eq('id', organizationId).single();
    const now = new Date();
    const retentionUntil = new Date(now);
    retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (org?.retention_years || 5));
    const { error } = await supabase.from('staffs').update({
      deleted_at: now.toISOString(),
      deleted_by: userId,
      deletion_reason: normalizedReason,
      retention_until: retentionUntil.toISOString(),
    }).eq('id', staffId).eq('organization_id', organizationId).is('deleted_at', null);
    if (error) throw sanitizeDbError(error, 'action.staffs');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'staff.soft_delete', resourceType: 'staff', resourceId: staffId, details: { reason: normalizedReason } });
    return { success: true };
  });
}

export async function reorderStaffs(organizationId: string, staffIds: string[]) {
  return withSafeError('reorderStaffs', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'staffs');
    const supabase = await createSessionClient();
    const ids = Array.from(new Set(staffIds.filter(Boolean)));
    if (ids.length !== staffIds.length || ids.length > 500) throw new Error('並び順が不正です');
    const { error } = await supabase.rpc('reorder_staffs_authorized', { p_organization_id: organizationId, p_staff_ids: ids });
    if (error) throw sanitizeDbError(error, 'action.staffs');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'staff.reorder', resourceType: 'staff', details: { count: ids.length } });
    return { success: true };
  });
}

export type StaffPositionPreset = {
  id: string;
  name: string;
  sort_order: number | null;
};

export async function getStaffPositionPresets(organizationId: string): Promise<StaffPositionPreset[]> {
  return withSafeError('getStaffPositionPresets', async () => {
    await assertOrgRole(organizationId);
    const supabase = await createSessionClient();
    const { data, error } = await supabase
      .from('staff_position_presets')
      .select('id, name, sort_order')
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) throw sanitizeDbError(error, 'action.staffs');
    return (data ?? []) as StaffPositionPreset[];
  });
}

export async function saveStaffPositionPreset(organizationId: string, name: string) {
  return withSafeError('saveStaffPositionPreset', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'staffs');
    const supabase = await createSessionClient();
    const normalized = name.trim();
    if (normalized.length < 1 || normalized.length > 50) throw new Error('役職名は1〜50文字で入力してください');
    const { count } = await supabase
      .from('staff_position_presets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    const { data, error } = await supabase
      .from('staff_position_presets')
      .insert({ organization_id: organizationId, name: normalized, sort_order: count ?? 0 })
      .select('id')
      .single();
    if (error || !data) throw sanitizeDbError(error || new Error('役職プリセットを保存できませんでした'), 'action.staffs');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'staff_position_preset.create', resourceType: 'staff_position_preset', resourceId: data.id, details: { name: normalized } });
    return { success: true, id: data.id as string };
  });
}

export async function deleteStaffPositionPreset(organizationId: string, presetId: string) {
  return withSafeError('deleteStaffPositionPreset', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'staffs');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('staff_position_presets')
      .delete()
      .eq('id', presetId)
      .eq('organization_id', organizationId);
    if (error) throw sanitizeDbError(error, 'action.staffs');
    await recordAuditEvent({ organizationId, actorId: userId, action: 'staff_position_preset.delete', resourceType: 'staff_position_preset', resourceId: presetId });
    return { success: true };
  });
}
