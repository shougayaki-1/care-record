import { describe, expect, it } from 'vitest';
import { hasOrganizationPermission } from './permissions';
import { resolveAppDestination } from './workspaceNavigation';

describe('organization permissions', () => {
  it('limits account and organization changes to owners', () => {
    expect(hasOrganizationPermission('owner', 'manageAccounts')).toBe(true);
    expect(hasOrganizationPermission('manager', 'manageAccounts')).toBe(false);
    expect(hasOrganizationPermission('manager', 'manageOrganization')).toBe(false);
    expect(hasOrganizationPermission('staff', 'manageOrganization')).toBe(false);
  });

  it('allows managers to view account and audit information', () => {
    expect(hasOrganizationPermission('manager', 'viewAccounts')).toBe(true);
    expect(hasOrganizationPermission('manager', 'viewAuditLogs')).toBe(true);
    expect(hasOrganizationPermission('staff', 'viewAccounts')).toBe(false);
  });
});

describe('workspace navigation', () => {
  it('sends only users without membership to setup', () => {
    expect(resolveAppDestination('no_membership', false)).toBe('/setup');
    expect(resolveAppDestination('error', false)).toBeNull();
    expect(resolveAppDestination('forbidden', false)).toBeNull();
  });

  it('routes valid and expired sessions separately', () => {
    expect(resolveAppDestination('ready', true)).toBe('/app/record');
    expect(resolveAppDestination('session_expired', false)).toBe('/');
  });
});
