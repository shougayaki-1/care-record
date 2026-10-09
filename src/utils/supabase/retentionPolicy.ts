import 'server-only';

import { ExpectedActionError, sanitizeDbError } from '@/utils/errors';
import { createSessionClient } from './auth';

export type RetainedResource = 'report' | 'client' | 'staff' | 'shift' | 'organization';

export async function getRetentionPolicy(organizationId: string, resourceType: RetainedResource): Promise<{ years: number; legalBasis: string }> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.from('retention_policies')
    .select('retention_years, legal_basis')
    .eq('organization_id', organizationId)
    .eq('resource_type', resourceType)
    .maybeSingle();
  if (error) throw sanitizeDbError(error, 'retention.policy', { organizationId });
  if (!data) throw new ExpectedActionError('VALIDATION_ERROR', resourceType === 'shift'
    ? 'シフトの保持方針が未承認のため削除できません。事業所のオーナーに保持方針の承認を依頼してください。'
    : `${resourceType}の保持方針が承認されていません`);
  return { years: data.retention_years, legalBasis: data.legal_basis };
}

export function retentionDeadline(years: number, from = new Date()): string {
  const deadline = new Date(from);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + years);
  return deadline.toISOString();
}
