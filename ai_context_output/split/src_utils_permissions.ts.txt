import type { OrgRole } from '@/utils/supabase/auth';

export const ROLE_PERMISSIONS = {
  viewManagement: ['owner', 'manager'],
  viewReports: ['owner', 'manager'],
  manageClients: ['owner', 'manager'],
  manageStaffs: ['owner', 'manager'],
  manageShifts: ['owner', 'manager'],
  viewAccounts: ['owner', 'manager'],
  manageAccounts: ['owner'],
  viewAuditLogs: ['owner', 'manager'],
  manageOrganization: ['owner'],
  manageIntegrations: ['owner'],
  approveReports: ['owner', 'manager'],
} as const satisfies Record<string, readonly OrgRole[]>;

export type OrganizationPermission = keyof typeof ROLE_PERMISSIONS;

export function hasOrganizationPermission(role: OrgRole, permission: OrganizationPermission): boolean {
  return (ROLE_PERMISSIONS[permission] as readonly OrgRole[]).includes(role);
}
