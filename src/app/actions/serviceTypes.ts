'use server';
import { supabaseAdmin, assertOrgPermission, assertOrgRole } from '@/utils/supabase/auth';

export type ServiceType = {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export async function getServiceTypes(orgId: string): Promise<ServiceType[]> {
  await assertOrgRole(orgId);
  const { data, error } = await supabaseAdmin
    .from('service_types')
    .select('*')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('sort_order');
  if (error) throw new Error('サービス種別を取得できませんでした');
  return data ?? [];
}

export async function createServiceType(orgId: string, name: string): Promise<void> {
  await assertOrgPermission(orgId, 'organization');
  const { data: last } = await supabaseAdmin
    .from('service_types')
    .select('sort_order')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabaseAdmin
    .from('service_types')
    .insert({ organization_id: orgId, name, sort_order: (last?.sort_order ?? -1) + 1 });
  if (error) throw new Error('サービス種別の追加に失敗しました');
}

export async function updateServiceType(
  orgId: string,
  id: string,
  patch: { name?: string; is_active?: boolean; sort_order?: number }
): Promise<void> {
  await assertOrgPermission(orgId, 'organization');
  const { error } = await supabaseAdmin
    .from('service_types')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', orgId);
  if (error) throw new Error('サービス種別の更新に失敗しました');
}

export async function deleteServiceType(orgId: string, id: string): Promise<void> {
  await assertOrgPermission(orgId, 'organization');
  const { error } = await supabaseAdmin
    .from('service_types')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId);
  if (error) throw new Error('サービス種別の削除に失敗しました');
}
