export type PermissionScope = 'all' | 'assigned' | 'none';

export type RolePermissions = {
  records: {
    view:    PermissionScope;
    create:  PermissionScope;
    edit:    PermissionScope;
    delete:  'all' | 'none';
    approve: 'all' | 'none';
  };
  shifts: {
    view:    PermissionScope;
    create:  PermissionScope;
    edit:    PermissionScope;
    delete:  'all' | 'none';
    approve: 'all' | 'none';
  };
  management: {
    staffs:       boolean;
    clients:      boolean;
    accounts:     boolean;
    organization: boolean;
    integrations: boolean;
    auditLogs:    boolean;
    reports:      boolean;
  };
};

export type ManagementArea = keyof RolePermissions['management'];
export type RecordAction = keyof RolePermissions['records'];
export type ShiftAction = keyof RolePermissions['shifts'];

export const EMPTY_PERMISSIONS: RolePermissions = {
  records:    { view: 'none', create: 'none', edit: 'none', delete: 'none', approve: 'none' },
  shifts:     { view: 'none', create: 'none', edit: 'none', delete: 'none', approve: 'none' },
  management: { staffs: false, clients: false, accounts: false, organization: false, integrations: false, auditLogs: false, reports: false },
};

export const PRESET_MANAGER_PERMISSIONS: RolePermissions = {
  records:    { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  shifts:     { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  management: { staffs: true, clients: true, accounts: false, organization: false, integrations: false, auditLogs: true, reports: true },
};

export const PRESET_STAFF_PERMISSIONS: RolePermissions = {
  records:    { view: 'assigned', create: 'assigned', edit: 'assigned', delete: 'none', approve: 'none' },
  shifts:     { view: 'assigned', create: 'none',     edit: 'none',     delete: 'none', approve: 'none' },
  management: { staffs: false, clients: false, accounts: false, organization: false, integrations: false, auditLogs: false, reports: false },
};

export const FULL_PERMISSIONS: RolePermissions = {
  records:    { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  shifts:     { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
  management: { staffs: true, clients: true, accounts: true, organization: true, integrations: true, auditLogs: true, reports: true },
};

function mergeScope(scopes: PermissionScope[]): PermissionScope {
  if (scopes.includes('all')) return 'all';
  if (scopes.includes('assigned')) return 'assigned';
  return 'none';
}

function mergeBinary(values: ('all' | 'none')[]): 'all' | 'none' {
  return values.includes('all') ? 'all' : 'none';
}

export function mergePermissions(roles: RolePermissions[]): RolePermissions {
  if (roles.length === 0) return { ...EMPTY_PERMISSIONS };

  return {
    records: {
      view:    mergeScope(roles.map(r => r.records.view)),
      create:  mergeScope(roles.map(r => r.records.create)),
      edit:    mergeScope(roles.map(r => r.records.edit)),
      delete:  mergeBinary(roles.map(r => r.records.delete)),
      approve: mergeBinary(roles.map(r => r.records.approve)),
    },
    shifts: {
      view:    mergeScope(roles.map(r => r.shifts.view)),
      create:  mergeScope(roles.map(r => r.shifts.create)),
      edit:    mergeScope(roles.map(r => r.shifts.edit)),
      delete:  mergeBinary(roles.map(r => r.shifts.delete)),
      approve: mergeBinary(roles.map(r => r.shifts.approve)),
    },
    management: {
      staffs:       roles.some(r => r.management.staffs),
      clients:      roles.some(r => r.management.clients),
      accounts:     roles.some(r => r.management.accounts),
      organization: roles.some(r => r.management.organization),
      integrations: roles.some(r => r.management.integrations),
      auditLogs:    roles.some(r => r.management.auditLogs),
      reports:      roles.some(r => r.management.reports),
    },
  };
}

function scopeAllows(scope: PermissionScope, isAssigned: boolean): boolean {
  if (scope === 'all') return true;
  if (scope === 'assigned') return isAssigned;
  return false;
}

export function checkRecordPermission(
  eff: RolePermissions,
  action: RecordAction,
  isAssigned: boolean
): boolean {
  const value = eff.records[action];
  if (value === 'all' || value === 'none') return value === 'all';
  return scopeAllows(value, isAssigned);
}

export function checkShiftPermission(
  eff: RolePermissions,
  action: ShiftAction,
  isAssigned: boolean
): boolean {
  const value = eff.shifts[action];
  if (value === 'all' || value === 'none') return value === 'all';
  return scopeAllows(value, isAssigned);
}

export function checkManagementPermission(
  eff: RolePermissions,
  area: ManagementArea
): boolean {
  return eff.management[area];
}
