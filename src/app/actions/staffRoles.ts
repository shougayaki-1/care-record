'use server';
import type { ActionResult } from '@/types/actionResult';
import { sanitizeDbError, withActionResult } from '@/utils/errors';
import { assertOrgPermission, assertOrgRole, createSessionClient } from '@/utils/supabase/auth';

export type StaffRole = {
  id: string;
  organization_id: string;
  name: string;
  is_unpaid: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export async function getStaffRoles(orgId: string): Promise<ActionResult<StaffRole[]>> {
  return withActionResult('getStaffRoles', async () => {
    await assertOrgRole(orgId);
    const supabase = await createSessionClient();
    const { data, error } = await supabase
      .from('staff_roles')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('sort_order');
    if (error) throw sanitizeDbError(error, 'getStaffRoles');
    return data ?? [];
  });
}

export async function createStaffRole(
  orgId: string,
  name: string,
  isUnpaid: boolean = false
): Promise<ActionResult<void>> {
  return withActionResult('createStaffRole', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('create_staff_role_atomic', {
      p_organization_id: orgId,
      p_name: name,
      p_is_unpaid: isUnpaid,
    });
    if (error) throw sanitizeDbError(error, 'action.master-data');
  });
}

export async function updateStaffRole(
  orgId: string,
  id: string,
  patch: { name?: string; is_unpaid?: boolean; is_active?: boolean; sort_order?: number }
): Promise<ActionResult<void>> {
  return withActionResult('updateStaffRole', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('staff_roles')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw sanitizeDbError(error, 'action.master-data');
  });
}

export async function deleteStaffRole(orgId: string, id: string): Promise<ActionResult<void>> {
  return withActionResult('deleteStaffRole', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('staff_roles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw sanitizeDbError(error, 'action.master-data');
  });
}
