'use server';

import { supabaseAdmin, assertOrgPermission } from '@/utils/supabase/auth';
import { type RolePermissions, PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS } from '@/utils/permissions';
import { assertRoleManagerRemains } from '@/utils/supabase/roleSafety';

export async function getOrgRolesFull(orgId: string) {
  await assertOrgPermission(orgId, 'roles');
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
  await assertOrgPermission(orgId, 'roles');
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
  await assertOrgPermission(orgId, 'roles');
  if (patch.permissions) {
    await assertRoleManagerRemains(orgId, { updatedRole: { roleId, permissions: patch.permissions } });
  }
  const { error } = await supabaseAdmin
    .from('organization_roles')
    .update(patch)
    .eq('id', roleId)
    .eq('organization_id', orgId);
  if (error) throw new Error('ロールの更新に失敗しました');
}

export async function deleteOrgRole(orgId: string, roleId: string): Promise<void> {
  await assertOrgPermission(orgId, 'roles');
  await assertRoleManagerRemains(orgId, { deletedRoleId: roleId });
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
  await assertOrgPermission(orgId, 'roles');
  const permissions = preset === 'manager' ? PRESET_MANAGER_PERMISSIONS : PRESET_STAFF_PERMISSIONS;
  await assertRoleManagerRemains(orgId, { updatedRole: { roleId, permissions } });
  const { error } = await supabaseAdmin
    .from('organization_roles')
    .update({ permissions })
    .eq('id', roleId)
    .eq('organization_id', orgId)
    .eq('is_preset', true);
  if (error) throw new Error('プリセットのリセットに失敗しました');
}
