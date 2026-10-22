import { auditReportView } from '@/app/actions/reports';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import { supabase } from '@/lib/supabase';
import { readActionResult } from '@/utils/actionResult';
import { measureRecordLoad } from '@/utils/recordLoadTiming';
import type { FormAnswers, FormItem, RecordFormState, ReportStatus, TravelExpense } from './types';

/** Load the masters together; a query failure must not become an empty editable form. */
export async function loadRecordBaseData(organizationId: string, clientId: string) {
  try {
    const [client, template, staffs, assignments, serviceTypes, staffRoles] = await Promise.all([
      supabase.from('clients').select('id, name').eq('organization_id', organizationId).eq('id', clientId).single(),
      supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle(),
      supabase.from('staffs').select('id, name, user_id').eq('organization_id', organizationId)
        .is('archived_at', null).order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true }),
      supabase.from('assignments').select('staff_id, default_travel_cost_yen').eq('client_id', clientId),
      supabase.from('service_types').select('id, name').eq('organization_id', organizationId)
        .eq('is_active', true).is('deleted_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true }),
      supabase.from('staff_roles').select('id, name').eq('organization_id', organizationId)
        .eq('is_active', true).is('deleted_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true }),
    ]);
    if ([client, template, staffs, assignments, serviceTypes, staffRoles].some(result => result.error) || !client.data) {
      throw new Error('基礎データを読み込めませんでした');
    }
    const costs = new Map((assignments.data ?? []).map(row => [row.staff_id, row.default_travel_cost_yen]));
    const schema = (template.data?.schema as FormItem[]) || DEFAULT_TEMPLATE;
    return {
      clientName: client.data.name,
      template: schema.filter(item => !['service_time', 'travel_time', 'round_trip_distance_km', 'travel_cost_yen'].includes(item.id)),
      selectableStaffs: (staffs.data ?? []).map(staff => ({
        id: staff.id, name: staff.name, user_id: staff.user_id, defaultTravelCostYen: costs.get(staff.id) ?? null,
      })),
      serviceTypes: serviceTypes.data ?? [],
      staffRoles: staffRoles.data ?? [],
    } satisfies Partial<RecordFormState>;
  } catch {
    throw new Error('基礎データを読み込めませんでした');
  }
}

/** Return body content only after all reads and the existing view audit succeed. */
export async function loadExistingRecord({
  organizationId, clientId, reportId, isCurrent, formatDatetimeLocal,
}: {
  organizationId: string;
  clientId: string;
  reportId: string;
  isCurrent: () => boolean;
  formatDatetimeLocal: (date: Date) => string;
}) {
  const { data: report, error } = await measureRecordLoad('report', () => supabase.from('reports')
    .select('*').eq('client_id', clientId).eq('id', reportId).is('deleted_at', null).maybeSingle());
  if (error) throw error;
  if (!isCurrent()) return;
  if (!report?.start_at || !report.end_at) throw new Error('記録が見つからないか、日時が不正です');

  // reports and shifts have no direct FK; keep the separate lookup.
  const shiftPromise = report.shift_id && !report.segment_id
    ? supabase.from('shifts').select('start_at, end_at').eq('id', report.shift_id).maybeSingle()
    : Promise.resolve(null);
  const [shift, values, actualStaffs] = await Promise.all([
    shiftPromise,
    measureRecordLoad('values', () => supabase.from('report_values').select('data').eq('report_id', reportId).maybeSingle()),
    measureRecordLoad('actual-staffs', () => supabase.from('report_actual_staffs')
      .select('staff_id, staff_role_id, staff:staffs(name)').eq('report_id', reportId).order('sort_order', { ascending: true })),
    measureRecordLoad('audit', () => readActionResult(auditReportView(organizationId, reportId))),
  ]);
  if (!isCurrent()) return;
  if (values.error || actualStaffs.error || shift?.error) throw new Error('記録を読み込めませんでした');

  // Missing values remain a valid empty answer; failed reads never reach this conversion.
  const answers = (values.data?.data || {}) as FormAnswers & { service_time?: string; travel_time?: string; _helpers?: string[] };
  const staffRows = actualStaffs.data ?? [];
  const travelRows = (values.data?.data as { travel_expenses?: Array<{ staff_id: string; method: TravelExpense['method']; amount_yen: number | null }> } | null)?.travel_expenses;
  let travelExpenses: Record<string, TravelExpense> = {};
  if (Array.isArray(travelRows)) {
    travelExpenses = Object.fromEntries(travelRows.map(row => [row.staff_id, {
      method: row.method, amountYen: row.amount_yen == null ? '' : String(row.amount_yen),
    }]));
  } else if (staffRows.length === 1 && answers.travel_cost_yen !== undefined) {
    travelExpenses = { [staffRows[0].staff_id]: { method: 'car', amountYen: String(answers.travel_cost_yen) } };
  }

  const form: Partial<RecordFormState> = {
    startDateTime: formatDatetimeLocal(new Date(report.start_at)),
    endDateTime: formatDatetimeLocal(new Date(report.end_at)),
    actualServiceTypeId: report.actual_service_type_id ?? '',
    serviceTime: answers.service_time || '',
    travelTime: answers.travel_time || '0',
    travelExpenses,
    actualStaffs: staffRows.map(staff => ({ staff_id: staff.staff_id, staff_role_id: staff.staff_role_id ?? null })),
    selectedHelpers: staffRows.length > 0 ? staffRows.map(staff => {
      const nested = Array.isArray(staff.staff) ? staff.staff[0] : staff.staff;
      return nested?.name;
    }).filter((name): name is string => Boolean(name)) : answers._helpers || [],
    answers,
  };
  if (shift?.data) {
    const start = new Date(shift.data.start_at);
    const end = new Date(shift.data.end_at);
    form.isSpanningMonth = start.getMonth() !== end.getMonth();
    form.originalShiftTimes = { start_at: shift.data.start_at, end_at: shift.data.end_at };
    if (form.isSpanningMonth) form.selectedPart = new Date(report.start_at).getTime() === start.getTime() ? 'part1' : 'part2';
  }
  return {
    form,
    status: (report.status ?? 'draft') as ReportStatus,
    version: Number(report.current_version ?? 0),
    segmentId: report.segment_id ?? null,
  };
}
