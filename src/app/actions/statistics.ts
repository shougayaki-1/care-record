'use server';

import { sanitizeDbError } from '@/utils/errors';
import { assertOrgPermission, supabaseAdmin } from '@/utils/supabase/auth';
import { listInternalWorkRecordsForStatistics } from '@/app/actions/internalWork';

export type StatisticsData = {
  shifts: unknown[];
  reports: unknown[];
  shiftsWithLinks: unknown[];
  internalWorkRecords: unknown[];
  premiumTypes: unknown[];
};

export async function getStatisticsData(
  organizationId: string,
  startAt: string,
  endAt: string,
): Promise<StatisticsData> {
  await assertOrgPermission(organizationId, 'reports');

  const [{ data: shifts, error: shiftsError }, { data: reports, error: reportsError }, { data: shiftsWithLinks, error: shiftsWithLinksError }, { data: premiumTypes, error: premiumTypesError }, internalWorkRecords] = await Promise.all([
    supabaseAdmin
      .from('shifts')
      .select(`
        id, start_at, end_at, status, client_id,
        clients (name),
        shift_staffs (staff_id, staffs(name))
      `)
      .eq('organization_id', organizationId)
      .neq('status', 'cancelled')
      .gte('end_at', startAt)
      .lte('start_at', endAt),
    supabaseAdmin
      .from('reports')
      .select(`
        id, start_at, end_at, status, client_id,
        clients!inner (id, name, organization_id),
        helper:profiles!reports_helper_id_fkey (name),
        report_values (data),
        report_shifts (shift_id)
      `)
      .eq('clients.organization_id', organizationId)
      .is('deleted_at', null)
      .in('status', ['pending', 'approved', 'remanded'])
      .gte('end_at', startAt)
      .lte('start_at', endAt),
    supabaseAdmin
      .from('shifts')
      .select(`
        id, start_at, end_at, client_id,
        clients (name),
        shift_staffs (staffs(name)),
        report_shifts (is_primary, reports(id, start_at, end_at, status, report_values(data)))
      `)
      .eq('organization_id', organizationId)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .gte('end_at', startAt)
      .lte('start_at', endAt),
    supabaseAdmin
      .from('labor_premium_types')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_enabled', true)
      .order('display_order'),
    listInternalWorkRecordsForStatistics(organizationId, startAt, endAt),
  ]);

  if (shiftsError) throw sanitizeDbError(shiftsError, 'action.statistics.shifts');
  if (reportsError) throw sanitizeDbError(reportsError, 'action.statistics.reports');
  if (shiftsWithLinksError) throw sanitizeDbError(shiftsWithLinksError, 'action.statistics.shiftLinks');
  if (premiumTypesError) throw sanitizeDbError(premiumTypesError, 'action.statistics.premiumTypes');

  return {
    shifts: shifts ?? [],
    reports: reports ?? [],
    shiftsWithLinks: shiftsWithLinks ?? [],
    internalWorkRecords,
    premiumTypes: premiumTypes ?? [],
  };
}
