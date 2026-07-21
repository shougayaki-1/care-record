'use server';
import { sanitizeDbError, withSafeError } from '@/utils/errors';
import { assertOrgPermission, assertOrgRole, createSessionClient } from '@/utils/supabase/auth';

export type ServiceType = {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export async function getServiceTypes(orgId: string): Promise<ServiceType[]> {
  return withSafeError('getServiceTypes', async () => {
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

export async function createServiceType(orgId: string, name: string): Promise<void> {
  return withSafeError('createServiceType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('create_service_type_atomic', {
      p_organization_id: orgId,
      p_name: name,
    });
    if (error) throw new Error('サービス種別の追加に失敗しました');
  });
}

export async function updateServiceType(
  orgId: string,
  id: string,
  patch: { name?: string; is_active?: boolean; sort_order?: number }
): Promise<void> {
  return withSafeError('updateServiceType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('service_types')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw new Error('サービス種別の更新に失敗しました');
  });
}

export async function deleteServiceType(orgId: string, id: string): Promise<void> {
  return withSafeError('deleteServiceType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('service_types')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw new Error('サービス種別の削除に失敗しました');
  });
}
