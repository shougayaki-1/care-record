'use server';
import { supabaseAdmin, assertOrgPermission, assertOrgRole } from '@/utils/supabase/auth';

export type StaffRole = {
  id: string;
  organization_id: string;
  name: string;
  is_unpaid: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export async function getStaffRoles(orgId: string): Promise<StaffRole[]> {
  await assertOrgRole(orgId);
  const { data, error } = await supabaseAdmin
    .from('staff_roles')
    .select('*')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('sort_order');
  if (error) throw new Error('スタッフ役割を取得できませんでした');
  return data ?? [];
}

export async function createStaffRole(
  orgId: string,
  name: string,
  isUnpaid: boolean = false
): Promise<void> {
  await assertOrgPermission(orgId, 'organization');
  const { data: last } = await supabaseAdmin
    .from('staff_roles')
    .select('sort_order')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabaseAdmin
    .from('staff_roles')
    .insert({
      organization_id: orgId,
      name,
      is_unpaid: isUnpaid,
      sort_order: (last?.sort_order ?? -1) + 1,
    });
  if (error) throw new Error('スタッフ役割の追加に失敗しました');
}

export async function updateStaffRole(
  orgId: string,
  id: string,
  patch: { name?: string; is_unpaid?: boolean; is_active?: boolean; sort_order?: number }
): Promise<void> {
  await assertOrgPermission(orgId, 'organization');
  const { error } = await supabaseAdmin
    .from('staff_roles')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', orgId);
  if (error) throw new Error('スタッフ役割の更新に失敗しました');
}

export async function deleteStaffRole(orgId: string, id: string): Promise<void> {
  await assertOrgPermission(orgId, 'organization');
  const { error } = await supabaseAdmin
    .from('staff_roles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId);
  if (error) throw new Error('スタッフ役割の削除に失敗しました');
}
