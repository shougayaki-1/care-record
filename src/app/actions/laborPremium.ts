'use server';
import type { ActionResult } from '@/types/actionResult';

import { sanitizeDbError, withActionResult } from '@/utils/errors';
import { assertOrgRole, assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';

export async function getLaborPremiumTypes(orgId: string) {
  return withActionResult('getLaborPremiumTypes', async () => {
    await assertOrgRole(orgId);
    const supabase = await createSessionClient();
    const { data, error } = await supabase
      .from('labor_premium_types')
      .select('*')
      .eq('organization_id', orgId)
      .order('display_order');
    if (error) throw sanitizeDbError(error, 'action.laborPremium');
    return data ?? [];
  });
}

export async function updateLaborPremiumType(
  orgId: string,
  typeId: string,
  patch: {
    name?: string;
    rate?: number;
    calc_method?: 'additive' | 'multiplicative';
    is_enabled?: boolean;
    night_start_hour?: number | null;
    night_end_hour?: number | null;
    overtime_daily_threshold_hours?: number | null;
    overtime_weekly_threshold_hours?: number | null;
    variable_working_hours_enabled?: boolean;
    variable_overtime_period?: 'week' | 'month' | null;
    variable_overtime_threshold_hours?: number | null;
  }
): Promise<ActionResult<void>> {
  return withActionResult('updateLaborPremiumType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('labor_premium_types')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', typeId)
      .eq('organization_id', orgId);
    if (error) throw sanitizeDbError(error, 'action.laborPremium');
  });
}

export async function createLaborPremiumType(
  orgId: string,
  data: {
    name: string;
    rate: number;
    calc_method: 'additive' | 'multiplicative';
    night_start_hour: number;
    night_end_hour: number;
    variable_working_hours_enabled?: boolean;
    variable_overtime_period?: 'week' | 'month' | null;
    variable_overtime_threshold_hours?: number | null;
  }
): Promise<ActionResult<void>> {
  return withActionResult('createLaborPremiumType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('create_labor_premium_type_atomic', {
      p_organization_id: orgId,
      p_name: data.name,
      p_rate: data.rate,
      p_calc_method: data.calc_method,
      p_night_start_hour: data.night_start_hour,
      p_night_end_hour: data.night_end_hour,
      p_variable_working_hours_enabled: data.variable_working_hours_enabled ?? false,
      p_variable_overtime_period: data.variable_overtime_period ?? undefined,
      p_variable_overtime_threshold_hours: data.variable_overtime_threshold_hours ?? undefined,
    });
    if (error) throw sanitizeDbError(error, 'action.laborPremium');
  });
}

export async function disableLaborPremiumType(orgId: string, typeId: string): Promise<ActionResult<void>> {
  return withActionResult('disableLaborPremiumType', async () => {
    await assertOrgPermission(orgId, 'organization');
    const supabase = await createSessionClient();
    const { error } = await supabase
      .from('labor_premium_types')
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq('id', typeId)
      .eq('organization_id', orgId);
    if (error) throw sanitizeDbError(error, 'action.laborPremium');
  });
}
