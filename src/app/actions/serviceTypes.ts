'use server';
import type { ActionResult } from '@/types/actionResult';
import { sanitizeDbError, withActionResult } from '@/utils/errors';
import { assertOrgPermission, assertOrgRole, createSessionClient } from '@/utils/supabase/auth';

export type ServiceType = {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export async function getServiceTypes(orgId: string): Promise<ActionResult<ServiceType[]>> {
  return withActionResult('getServiceTypes', async () => {
    await assertOrgRole(orgId);
    const supabase = await createSessionClient();
    const { data, error } = await supabase
      .from('service_types')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('sort_order');
    if (error) throw sanitizeDbError(error, 'getServiceTypes');
    return data ?? [];
  });
}

export async function createServiceType(orgId: string, name: string): Promise<ActionResult<void>> {
  return withActionResult('createServiceType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('create_service_type_atomic', {
      p_organization_id: orgId,
      p_name: name,
    });
    if (error) throw sanitizeDbError(error, 'action.master-data');
  });
}

export async function updateServiceType(
  orgId: string,
  id: string,
  patch: { name?: string; is_active?: boolean; sort_order?: number }
): Promise<ActionResult<void>> {
  return withActionResult('updateServiceType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('service_types')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw sanitizeDbError(error, 'action.master-data');
  });
}

export async function deleteServiceType(orgId: string, id: string): Promise<ActionResult<void>> {
  return withActionResult('deleteServiceType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('service_types')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw sanitizeDbError(error, 'action.master-data');
  });
}
