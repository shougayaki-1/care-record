import { describe, it, expect } from 'vitest';
import { mergePermissions, normalizePermissions, checkRecordPermission, checkShiftPermission, checkManagementPermission, PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS, FULL_PERMISSIONS, type RolePermissions } from './permissions';

describe('mergePermissions', () => {
  it('returns EMPTY when given no roles', () => {
    expect(mergePermissions([]).records.view).toBe('none');
  });
  it('permit wins: all > assigned > none', () => {
    const r = mergePermissions([PRESET_STAFF_PERMISSIONS, PRESET_MANAGER_PERMISSIONS]);
    expect(r.records.view).toBe('all');
    expect(r.records.delete).toBe('all');
  });
  it('management: true wins', () => {
    const r = mergePermissions([PRESET_STAFF_PERMISSIONS, PRESET_MANAGER_PERMISSIONS]);
    expect(r.management.staffs).toBe(true);
    expect(r.management.accounts).toBe(false);
    expect(r.management.backupStatus).toBe(true);
  });
  it('treats missing new management keys as false', () => {
    const legacy = {
      records: PRESET_MANAGER_PERMISSIONS.records,
      shifts: PRESET_MANAGER_PERMISSIONS.shifts,
      management: {
        staffs: true,
        clients: true,
        accounts: true,
        organization: true,
        integrations: true,
        auditLogs: true,
        reports: true,
      },
    } as RolePermissions;
    const r = mergePermissions([legacy]);
    expect(r.management.roles).toBe(false);
    expect(r.management.organizationDelete).toBe(false);
    expect(r.management.backupStatus).toBe(false);
  });
  it('merges role management dangerous permissions', () => {
    const roleManager: RolePermissions = {
      ...PRESET_STAFF_PERMISSIONS,
      management: { ...PRESET_STAFF_PERMISSIONS.management, roles: true, organizationDelete: true },
    };
    const r = mergePermissions([PRESET_STAFF_PERMISSIONS, roleManager]);
    expect(checkManagementPermission(r, 'roles')).toBe(true);
    expect(checkManagementPermission(r, 'organizationDelete')).toBe(true);
  });
});
describe('checkRecordPermission', () => {
  it('all: allows regardless of assigned', () => expect(checkRecordPermission(FULL_PERMISSIONS, 'view', false)).toBe(true));
  it('assigned: allows only when assigned', () => {
    expect(checkRecordPermission(PRESET_STAFF_PERMISSIONS, 'view', false)).toBe(false);
    expect(checkRecordPermission(PRESET_STAFF_PERMISSIONS, 'view', true)).toBe(true);
  });
  it('none: always denies', () => expect(checkRecordPermission(PRESET_STAFF_PERMISSIONS, 'delete', true)).toBe(false));
});

describe('normalizePermissions (GAP-01 Option B)', () => {
  it('downgrades unsupported shift write scopes (create/edit/delete=assigned) to none', () => {
    const legacyRole = {
      shifts: { view: 'assigned', create: 'assigned', edit: 'assigned', delete: 'assigned' },
    } as unknown as RolePermissions;
    const normalized = normalizePermissions(legacyRole);
    expect(normalized.shifts.create).toBe('none');
    expect(normalized.shifts.edit).toBe('none');
    expect(normalized.shifts.delete).toBe('none');
  });

  it('keeps shifts.view=assigned intact', () => {
    const normalized = normalizePermissions({ shifts: { view: 'assigned', create: 'none', edit: 'none', delete: 'none' } } as RolePermissions);
    expect(normalized.shifts.view).toBe('assigned');
  });

  it('leaves all/none shift write scopes unchanged', () => {
    const normalized = normalizePermissions(FULL_PERMISSIONS);
    expect(normalized.shifts.create).toBe('all');
    expect(normalized.shifts.edit).toBe('all');
    expect(normalized.shifts.delete).toBe('all');
  });

  it('never escalates a downgraded role to all — mergePermissions still denies non-all write scopes', () => {
    const legacyRole = {
      shifts: { view: 'assigned', create: 'assigned', edit: 'assigned', delete: 'none' },
    } as unknown as RolePermissions;
    const merged = mergePermissions([legacyRole]);
    expect(merged.shifts.create).toBe('none');
    expect(merged.shifts.edit).toBe('none');
    expect(checkShiftPermission(merged, 'edit', true)).toBe(false);
    expect(checkShiftPermission(merged, 'edit', false)).toBe(false);
  });
});

describe('checkShiftPermission', () => {
  it('all: allows regardless of assigned', () => {
    expect(checkShiftPermission(FULL_PERMISSIONS, 'edit', false)).toBe(true);
  });

  it('assigned: allows only assigned shifts or assigned-client shifts', () => {
    expect(checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'view', true)).toBe(true);
    expect(checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'view', false)).toBe(false);
  });

  it('none: denies shift mutations', () => {
    expect(checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'create', true)).toBe(false);
    expect(checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'delete', true)).toBe(false);
  });
});
