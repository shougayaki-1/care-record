'use server';

import { sanitizeDbError, withSafeError } from '@/utils/errors';
import { PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS, type RolePermissions } from '@/utils/permissions';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import { assertOwnerForDangerousPermissions, assertRoleManagerRemains } from '@/utils/supabase/roleSafety';

type RolePatch = Partial<{ name: string; color: string | null; permissions: RolePermissions }>;

function permissionDiff(before: RolePermissions | null, after: RolePermissions | null): Record<string, { before: unknown; after: unknown }> {
  const result: Record<string, { before: unknown; after: unknown }> = {};
  const walk = (path: string, left: unknown, right: unknown) => {
    const leftRecord = left && typeof left === 'object' && !Array.isArray(left) ? left as Record<string, unknown> : null;
    const rightRecord = right && typeof right === 'object' && !Array.isArray(right) ? right as Record<string, unknown> : null;
    if (leftRecord || rightRecord) {
      for (const key of new Set([...Object.keys(leftRecord ?? {}), ...Object.keys(rightRecord ?? {})])) {
        walk(path ? `${path}.${key}` : key, leftRecord?.[key], rightRecord?.[key]);
      }
      return;
    }
    if (left !== right) result[path] = { before: left ?? null, after: right ?? null };
  };
  walk('', before, after);
  return result;
}

export async function getOrgRolesFull(orgId: string) {
  return withSafeError('getOrgRolesFull', async () => {
    await assertOrgPermission(orgId, 'roles');
    const supabase = await createSessionClient();
    const { data, error } = await supabase.from('organization_roles').select('*').eq('organization_id', orgId).order('is_preset', { ascending: false });
    if (error) throw sanitizeDbError(error, 'action.roles.list');
    return data ?? [];
  });
}

export async function createOrgRole(orgId: string, name: string, color: string | null, permissions: RolePermissions): Promise<{ id: string }> {
  return withSafeError('createOrgRole', async () => {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'roles');
    assertOwnerForDangerousPermissions(permissions, isOwner);
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc('mutate_organization_role_authorized', {
      p_organization_id: orgId, p_role_id: null, p_action: 'create',
      p_name: name, p_color: color, p_permissions: permissions, p_require_preset: false,
    });
    if (error) throw sanitizeDbError(error, 'action.roles.create');
    const roleId = String(data);
    await recordAuditEvent({
      organizationId: orgId, actorId: userId, action: 'role.create', resourceType: 'organization_role', resourceId: roleId,
      details: { fields: ['name', 'color', 'permissions'], permissions: { before: null, after: permissions }, permissionDiff: permissionDiff(null, permissions) },
    });
    return { id: roleId };
  });
}

export async function updateOrgRole(orgId: string, roleId: string, patch: RolePatch): Promise<void> {
  return withSafeError('updateOrgRole', async () => {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'roles');
    const supabase = await createSessionClient();
    const { data: existing, error: readError } = await supabase
      .from('organization_roles').select('name, color, permissions').eq('id', roleId).eq('organization_id', orgId).maybeSingle();
    if (readError) throw sanitizeDbError(readError, 'action.roles.update.read');
    if (!existing) throw new Error('対象のロールが見つかりません');
    const beforePermissions = existing.permissions as RolePermissions;
    const effectivePermissions = patch.permissions ?? beforePermissions;
    assertOwnerForDangerousPermissions(effectivePermissions, isOwner);
    if (patch.permissions) await assertRoleManagerRemains(orgId, { updatedRole: { roleId, permissions: patch.permissions } });
    const { error } = await supabase.rpc('mutate_organization_role_authorized', {
      p_organization_id: orgId, p_role_id: roleId, p_action: 'update',
      p_name: patch.name ?? existing.name,
      p_color: patch.color === undefined ? existing.color : patch.color,
      p_permissions: effectivePermissions, p_require_preset: false,
    });
    if (error) throw sanitizeDbError(error, 'action.roles.update');
    await recordAuditEvent({
      organizationId: orgId, actorId: userId, action: 'role.update', resourceType: 'organization_role', resourceId: roleId,
      details: {
        fields: Object.keys(patch),
        before: { name: existing.name, color: existing.color, permissions: beforePermissions },
        after: { name: patch.name ?? existing.name, color: patch.color === undefined ? existing.color : patch.color, permissions: effectivePermissions },
        permissionDiff: permissionDiff(beforePermissions, effectivePermissions),
      },
    });
  });
}

export async function deleteOrgRole(orgId: string, roleId: string): Promise<void> {
  return withSafeError('deleteOrgRole', async () => {
    const { userId } = await assertOrgPermission(orgId, 'roles');
    const supabase = await createSessionClient();
    const { data: existing, error: readError } = await supabase
      .from('organization_roles').select('name, color, permissions').eq('id', roleId).eq('organization_id', orgId).maybeSingle();
    if (readError) throw sanitizeDbError(readError, 'action.roles.delete.read');
    if (!existing) throw new Error('対象のロールが見つかりません');
    await assertRoleManagerRemains(orgId, { deletedRoleId: roleId });
    const { error } = await supabase.rpc('mutate_organization_role_authorized', {
      p_organization_id: orgId, p_role_id: roleId, p_action: 'delete',
      p_name: null, p_color: null, p_permissions: null, p_require_preset: false,
    });
    if (error) throw sanitizeDbError(error, 'action.roles.delete');
    await recordAuditEvent({
      organizationId: orgId, actorId: userId, action: 'role.delete', resourceType: 'organization_role', resourceId: roleId,
      details: { fields: ['name', 'color', 'permissions'], before: existing, after: null, permissionDiff: permissionDiff(existing.permissions as RolePermissions, null) },
    });
  });
}

export async function resetPresetRole(orgId: string, roleId: string, preset: 'manager' | 'staff'): Promise<void> {
  return withSafeError('resetPresetRole', async () => {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'roles');
    const permissions = preset === 'manager' ? PRESET_MANAGER_PERMISSIONS : PRESET_STAFF_PERMISSIONS;
    assertOwnerForDangerousPermissions(permissions, isOwner);
    const supabase = await createSessionClient();
    const { data: existing, error: readError } = await supabase
      .from('organization_roles').select('permissions').eq('id', roleId).eq('organization_id', orgId).eq('is_preset', true).maybeSingle();
    if (readError) throw sanitizeDbError(readError, 'action.roles.reset.read');
    if (!existing) throw new Error('対象のプリセットロールが見つかりません');
    await assertRoleManagerRemains(orgId, { updatedRole: { roleId, permissions } });
    const { error } = await supabase.rpc('mutate_organization_role_authorized', {
      p_organization_id: orgId, p_role_id: roleId, p_action: 'reset',
      p_name: null, p_color: null, p_permissions: permissions, p_require_preset: true,
    });
    if (error) throw sanitizeDbError(error, 'action.roles.reset');
    await recordAuditEvent({
      organizationId: orgId, actorId: userId, action: 'role.preset_reset', resourceType: 'organization_role', resourceId: roleId,
      details: { preset, fields: ['permissions'], permissions: { before: existing.permissions, after: permissions }, permissionDiff: permissionDiff(existing.permissions as RolePermissions, permissions) },
    });
  });
}
