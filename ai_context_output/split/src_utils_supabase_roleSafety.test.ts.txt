import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/supabase/auth', () => ({ supabaseAdmin: {} }));

import { FULL_PERMISSIONS, PRESET_MANAGER_PERMISSIONS, PRESET_STAFF_PERMISSIONS } from '@/utils/permissions';
import { assertOwnerForDangerousPermissions, isDangerousPermissions } from './roleSafety';

describe('dangerous role permissions', () => {
  it('identifies the dangerous management permissions', () => {
    expect(isDangerousPermissions(PRESET_STAFF_PERMISSIONS)).toBe(false);
    expect(isDangerousPermissions(PRESET_MANAGER_PERMISSIONS)).toBe(false);
    expect(isDangerousPermissions(FULL_PERMISSIONS)).toBe(true);
  });

  it('rejects non-owners and permits owners for dangerous permissions', () => {
    expect(() => assertOwnerForDangerousPermissions(FULL_PERMISSIONS, false)).toThrow('オーナーのみ');
    expect(() => assertOwnerForDangerousPermissions(FULL_PERMISSIONS, true)).not.toThrow();
    expect(() => assertOwnerForDangerousPermissions(PRESET_MANAGER_PERMISSIONS, false)).not.toThrow();
  });
});
