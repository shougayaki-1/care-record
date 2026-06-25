import { describe, it, expect } from 'vitest';
import { mergePermissions, checkRecordPermission, checkManagementPermission, EMPTY_PERMISSIONS, PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS, FULL_PERMISSIONS } from './permissions';

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
