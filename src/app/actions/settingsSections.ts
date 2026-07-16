'use server';
import { assertOrgRole, createSessionClient } from '@/utils/supabase/auth';
import type { LaborPremiumType } from '@/utils/laborPremium';
import type { ServiceType } from '@/app/actions/serviceTypes';
import type { StaffRole } from '@/app/actions/staffRoles';

// settings ページの「労働時間ルール」「サービス種別」「スタッフ役割」の3セクションが
// 同時にマウントされ、それぞれ独自に assertOrgRole + 単純な1テーブル取得を行っていたのを
// 1回の権限確認 + Promise.all による並列取得にまとめたもの。
// 既存の getLaborPremiumTypes / getServiceTypes / getStaffRoles は、各コンポーネントの
// 保存後の再取得や単体利用時のフォールバックとして変更せず維持する。
export async function getSettingsSectionsData(orgId: string): Promise<{
  laborPremiumTypes: LaborPremiumType[];
  serviceTypes: ServiceType[];
  staffRoles: StaffRole[];
}> {
  await assertOrgRole(orgId);
  const supabase = await createSessionClient();

  const [laborPremiumResult, serviceTypesResult, staffRolesResult] = await Promise.all([
    supabase
      .from('labor_premium_types')
      .select('*')
      .eq('organization_id', orgId)
      .order('display_order'),
    supabase
      .from('service_types')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('staff_roles')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('sort_order'),
  ]);

  if (laborPremiumResult.error) throw new Error('労働時間ルールを取得できませんでした');
  if (serviceTypesResult.error) throw new Error('サービス種別を取得できませんでした');
  if (staffRolesResult.error) throw new Error('スタッフ役割を取得できませんでした');

  return {
    laborPremiumTypes: (laborPremiumResult.data ?? []) as LaborPremiumType[],
    serviceTypes: (serviceTypesResult.data ?? []) as ServiceType[],
    staffRoles: (staffRolesResult.data ?? []) as StaffRole[],
  };
}
