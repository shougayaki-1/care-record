'use server';
import { supabaseAdmin, assertOrgRole } from '@/utils/supabase/auth';

export async function getLaborPremiumTypes(orgId: string) {
  await assertOrgRole(orgId);
  const { data, error } = await supabaseAdmin
    .from('labor_premium_types')
    .select('*')
    .eq('organization_id', orgId)
    .order('display_order');
  if (error) throw new Error('労働時間ルールを取得できませんでした');
  return data ?? [];
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
  }
): Promise<void> {
  await assertOrgRole(orgId, ['owner', 'manager']);
  const { error } = await supabaseAdmin
    .from('labor_premium_types')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', typeId)
    .eq('organization_id', orgId);
  if (error) throw new Error('更新に失敗しました');
}

export async function createLaborPremiumType(
  orgId: string,
  data: {
    name: string;
    rate: number;
    calc_method: 'additive' | 'multiplicative';
    night_start_hour: number;
    night_end_hour: number;
  }
): Promise<void> {
  await assertOrgRole(orgId, ['owner', 'manager']);
  const { data: last } = await supabaseAdmin
    .from('labor_premium_types')
    .select('display_order')
    .eq('organization_id', orgId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabaseAdmin
    .from('labor_premium_types')
    .insert({
      organization_id: orgId,
      display_order: (last?.display_order ?? 0) + 1,
      builtin_type: 'custom',
      ...data,
    });
  if (error) throw new Error('追加に失敗しました');
}

export async function disableLaborPremiumType(orgId: string, typeId: string): Promise<void> {
  await assertOrgRole(orgId, ['owner', 'manager']);
  await supabaseAdmin
    .from('labor_premium_types')
    .update({ is_enabled: false, updated_at: new Date().toISOString() })
    .eq('id', typeId)
    .eq('organization_id', orgId);
}
