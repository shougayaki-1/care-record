import { mergePermissions, normalizePermissions, type RolePermissions } from '@/utils/permissions';
import { createSessionClient } from '@/utils/supabase/auth';

type RoleRow = { id: string; permissions: RolePermissions };
type MemberRow = { user_id: string; role: string };
type LinkRow = { user_id: string; role_id: string };

type RoleSafetyPatch = {
  updatedRole?: { roleId: string; permissions: RolePermissions };
  deletedRoleId?: string;
  replacedMemberRoles?: { userId: string; roleIds: string[] };
  removedMemberId?: string;
};

export function isDangerousPermissions(permissions: RolePermissions): boolean {
  const { accounts, roles, organizationDelete, ownerTransfer } = normalizePermissions(permissions).management;
  return accounts || roles || organizationDelete || ownerTransfer;
}

export function assertOwnerForDangerousPermissions(permissions: RolePermissions, isOwner: boolean): void {
  if (isDangerousPermissions(permissions) && !isOwner) {
    throw new Error('危険な権限を含むロールの変更はオーナーのみ実行できます');
  }
}

export async function assertRoleManagerRemains(
  organizationId: string,
  patch: RoleSafetyPatch = {},
): Promise<void> {
  const supabase = await createSessionClient();
  const [{ data: roles, error: rolesError }, { data: members, error: membersError }, { data: links, error: linksError }] = await Promise.all([
    supabase
      .from('organization_roles')
      .select('id, permissions')
      .eq('organization_id', organizationId),
    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId),
    supabase
      .from('organization_member_roles')
      .select('user_id, role_id')
      .eq('organization_id', organizationId),
  ]);

  if (rolesError || membersError || linksError) throw new Error('ロール管理者の安全確認に失敗しました');

  const roleMap = new Map<string, RolePermissions>();
  for (const role of (roles ?? []) as RoleRow[]) {
    if (role.id !== patch.deletedRoleId) {
      roleMap.set(role.id, role.permissions);
    }
  }
  if (patch.updatedRole && patch.updatedRole.roleId !== patch.deletedRoleId) {
    roleMap.set(patch.updatedRole.roleId, patch.updatedRole.permissions);
  }

  const memberIds = new Set((members ?? []).map((member: MemberRow) => member.user_id));
  const ownerIds = new Set(
    (members ?? []).filter((member: MemberRow) => member.role === 'owner').map((member: MemberRow) => member.user_id),
  );
  if (patch.removedMemberId) memberIds.delete(patch.removedMemberId);

  const rolesByMember = new Map<string, string[]>();
  for (const link of (links ?? []) as LinkRow[]) {
    if (!memberIds.has(link.user_id) || link.role_id === patch.deletedRoleId) continue;
    const roleIds = rolesByMember.get(link.user_id) ?? [];
    roleIds.push(link.role_id);
    rolesByMember.set(link.user_id, roleIds);
  }
  if (patch.replacedMemberRoles && memberIds.has(patch.replacedMemberRoles.userId)) {
    rolesByMember.set(patch.replacedMemberRoles.userId, patch.replacedMemberRoles.roleIds);
  }

  for (const userId of memberIds) {
    // Mirrors private.has_management_permission: an organization owner always counts
    // as a role manager, regardless of any explicit organization_member_roles link.
    if (ownerIds.has(userId)) return;

    const permissions = mergePermissions(
      (rolesByMember.get(userId) ?? [])
        .map(roleId => roleMap.get(roleId))
        .filter((permissions): permissions is RolePermissions => permissions != null),
    );
    if (permissions.management.roles) return;
  }

  throw new Error('ロールを管理できるメンバーが0人になるため、この操作はできません');
}
