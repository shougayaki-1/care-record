'use server';
import type { ActionResult } from '@/types/actionResult';
import { sanitizeDbError, withActionResult } from '@/utils/errors';
import { assertOrgRole, createSessionClient } from '@/utils/supabase/auth';
import type { LaborPremiumType } from '@/utils/laborPremium';
import type { ServiceType } from '@/app/actions/serviceTypes';
import type { StaffRole } from '@/app/actions/staffRoles';

// settings ページの「労働時間ルール」「サービス種別」「スタッフ役割」の3セクションが
// 同時にマウントされ、それぞれ独自に assertOrgRole + 単純な1テーブル取得を行っていたのを
// 1回の権限確認 + Promise.all による並列取得にまとめたもの。
// 既存の getLaborPremiumTypes / getServiceTypes / getStaffRoles は、各コンポーネントの
// 保存後の再取得や単体利用時のフォールバックとして維持する。
export async function getSettingsSectionsData(orgId: string): Promise<ActionResult<{
  laborPremiumTypes: LaborPremiumType[];
  serviceTypes: ServiceType[];
  staffRoles: StaffRole[];
}>> {
  return withActionResult('getSettingsSectionsData', async () => {
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

    if (laborPremiumResult.error) throw sanitizeDbError(laborPremiumResult.error, 'settings.labor-premiums');
    if (serviceTypesResult.error) throw sanitizeDbError(serviceTypesResult.error, 'settings.service-types');
    if (staffRolesResult.error) throw sanitizeDbError(staffRolesResult.error, 'settings.staff-roles');

    return {
      laborPremiumTypes: (laborPremiumResult.data ?? []) as LaborPremiumType[],
      serviceTypes: (serviceTypesResult.data ?? []) as ServiceType[],
      staffRoles: (staffRolesResult.data ?? []) as StaffRole[],
    };
  });
}
