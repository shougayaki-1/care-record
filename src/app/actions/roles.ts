'use server';

import { supabaseAdmin, assertOwner } from '@/utils/supabase/auth';
import { type RolePermissions, PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS } from '@/utils/permissions';

export async function getOrgRolesFull(orgId: string) {
  await assertOwner(orgId);
  const { data, error } = await supabaseAdmin
    .from('organization_roles')
    .select('*')
    .eq('organization_id', orgId)
    .order('is_preset', { ascending: false });
  if (error) throw new Error('ロール一覧を取得できませんでした');
  return data ?? [];
}

export async function createOrgRole(
  orgId: string,
  name: string,
  color: string | null,
  permissions: RolePermissions
): Promise<{ id: string }> {
  await assertOwner(orgId);
  const { data, error } = await supabaseAdmin
    .from('organization_roles')
    .insert({ organization_id: orgId, name, color, is_preset: false, permissions })
    .select('id')
    .single();
  if (error) throw new Error('ロールの作成に失敗しました: ' + error.message);
  return { id: data.id };
}

export async function updateOrgRole(
  orgId: string,
  roleId: string,
  patch: Partial<{ name: string; color: string | null; permissions: RolePermissions }>
): Promise<void> {
  await assertOwner(orgId);
  const { error } = await supabaseAdmin
    .from('organization_roles')
    .update(patch)
    .eq('id', roleId)
    .eq('organization_id', orgId);
  if (error) throw new Error('ロールの更新に失敗しました');
}

export async function deleteOrgRole(orgId: string, roleId: string): Promise<void> {
  await assertOwner(orgId);
  const { error } = await supabaseAdmin
    .from('organization_roles')
    .delete()
    .eq('id', roleId)
    .eq('organization_id', orgId);
  if (error) throw new Error('ロールの削除に失敗しました');
}

export async function resetPresetRole(
  orgId: string,
  roleId: string,
  preset: 'manager' | 'staff'
): Promise<void> {
  await assertOwner(orgId);
  const permissions = preset === 'manager' ? PRESET_MANAGER_PERMISSIONS : PRESET_STAFF_PERMISSIONS;
  const { error } = await supabaseAdmin
    .from('organization_roles')
    .update({ permissions })
    .eq('id', roleId)
    .eq('organization_id', orgId)
    .eq('is_preset', true);
  if (error) throw new Error('プリセットのリセットに失敗しました');
}
