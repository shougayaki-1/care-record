'use server';

import { sanitizeDbError } from '@/utils/errors';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, assertOrgPermission, supabaseAdmin } from '@/utils/supabase/auth';

export type Office = {
  id: string;
  organization_id: string;
  name: string;
  travel_cost_rate_yen_per_km: number;
  archived_at: string | null;
  created_at: string;
};

function validateRate(rateYenPerKm: number): number {
  const rate = Number(rateYenPerKm);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10000) {
    throw new Error('交通費単価は0〜10000円で入力してください');
  }
  return rate;
}

function validateName(name: string): string {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 100) throw new Error('事業所名は1〜100文字で入力してください');
  return normalized;
}

export async function getOffices(orgId: string): Promise<Office[]> {
  await assertOrgRole(orgId);
  const { data, error } = await supabaseAdmin
    .from('offices')
    .select('*')
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw sanitizeDbError(error, 'action.offices');
  return (data ?? []) as Office[];
}

export async function createOffice(orgId: string, name: string, rateYenPerKm: number): Promise<Office> {
  const { userId } = await assertOrgPermission(orgId, 'organization');
  const normalizedName = validateName(name);
  const rate = validateRate(rateYenPerKm);
  const { data, error } = await supabaseAdmin
    .from('offices')
    .insert({ organization_id: orgId, name: normalizedName, travel_cost_rate_yen_per_km: rate })
    .select('*')
    .single();
  if (error || !data) throw sanitizeDbError(error, 'action.offices');
  await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'office.create', resourceType: 'office', resourceId: data.id });
  return data as Office;
}

export async function updateOffice(
  orgId: string,
  officeId: string,
  patch: { name?: string; travel_cost_rate_yen_per_km?: number },
): Promise<void> {
  const { userId } = await assertOrgPermission(orgId, 'organization');
  const normalizedPatch: { name?: string; travel_cost_rate_yen_per_km?: number } = {};
  if (patch.name !== undefined) normalizedPatch.name = validateName(patch.name);
  if (patch.travel_cost_rate_yen_per_km !== undefined) normalizedPatch.travel_cost_rate_yen_per_km = validateRate(patch.travel_cost_rate_yen_per_km);

  const { error } = await supabaseAdmin
    .from('offices')
    .update(normalizedPatch)
    .eq('id', officeId)
    .eq('organization_id', orgId);
  if (error) throw sanitizeDbError(error, 'action.offices');
  await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'office.update', resourceType: 'office', resourceId: officeId });
}

export async function archiveOffice(orgId: string, officeId: string): Promise<void> {
  const { userId } = await assertOrgPermission(orgId, 'organization');
  const { error } = await supabaseAdmin
    .from('offices')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', officeId)
    .eq('organization_id', orgId);
  if (error) throw sanitizeDbError(error, 'action.offices');
  await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'office.archive', resourceType: 'office', resourceId: officeId });
}
