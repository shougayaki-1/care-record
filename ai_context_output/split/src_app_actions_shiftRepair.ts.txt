'use server';

import { createHash } from 'crypto';
import { assertShiftPermission } from '@/utils/supabase/auth';
import { serviceRoleForIncidentResponse } from '@/utils/supabase/serviceRole';
import { sanitizeDbError, withSafeError } from '@/utils/errors';

const supabaseAdmin = serviceRoleForIncidentResponse();

type RepairItem = {
  shiftId: string;
  hasSegments: boolean;
  hasSegmentStaffs: boolean;
  hasDerivedStaffs: boolean;
  isModified: boolean;
  hasReport: boolean;
  action: 'refresh_derived_staffs' | 'review_required';
};

function monthRange(yearMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error('対象月が不正です');
  const [year, month] = yearMonth.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const end = new Date(Date.UTC(year, month, 1)).toISOString();
  return { start, end };
}

/** Safe first-stage repair: never recreates segments. It only identifies rows
 * and rebuilds the denormalized shift_staffs table from existing segment staff. */
export async function previewShiftStaffRepair(organizationId: string, yearMonth: string) {
  return withSafeError('previewShiftStaffRepair', async () => {
  await assertShiftPermission(organizationId, 'edit', { requireAllScope: true });
  const { start, end } = monthRange(yearMonth);
  const { data: shifts, error } = await supabaseAdmin
    .from('shifts')
    .select('id, is_modified, shift_segments(id, shift_segment_staffs(staff_id)), shift_staffs(staff_id), reports(id)')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .gte('start_at', start)
    .lt('start_at', end);
  if (error) throw sanitizeDbError(error, 'action.shift-repair.preview');

  const items: RepairItem[] = (shifts ?? []).map((shift) => {
    const segments = (shift.shift_segments ?? []) as Array<{ id: string; shift_segment_staffs?: Array<{ staff_id: string }> }>;
    const segmentStaffIds = new Set(segments.flatMap((segment) => (segment.shift_segment_staffs ?? []).map((staff) => staff.staff_id)));
    const derived = new Set(((shift.shift_staffs ?? []) as Array<{ staff_id: string }>).map((staff) => staff.staff_id));
    const hasReport = Array.isArray(shift.reports) && shift.reports.length > 0;
    const hasSegments = segments.length > 0;
    const hasSegmentStaffs = segmentStaffIds.size > 0;
    const matches = segmentStaffIds.size === derived.size && [...segmentStaffIds].every((id) => derived.has(id));
    return {
      shiftId: shift.id,
      hasSegments,
      hasSegmentStaffs,
      hasDerivedStaffs: derived.size > 0,
      isModified: Boolean(shift.is_modified),
      hasReport,
      action: hasSegmentStaffs && !matches ? 'refresh_derived_staffs' : 'review_required',
    };
  });
  return {
    yearMonth,
    items,
    refreshable: items.filter((item) => item.action === 'refresh_derived_staffs').length,
    reviewRequired: items.filter((item) => item.action === 'review_required' && !item.hasSegmentStaffs).length,
  };
  });
}

export async function applyShiftStaffRepair(organizationId: string, yearMonth: string) {
  return withSafeError('applyShiftStaffRepair', async () => {
  const actor = await assertShiftPermission(organizationId, 'edit', { requireAllScope: true });
  const preview = await previewShiftStaffRepair(organizationId, yearMonth);
  const { data: run, error: runError } = await supabaseAdmin.from('maintenance_runs').insert({
    organization_id: organizationId,
    kind: 'shift_staff_denorm_repair',
    target_month: yearMonth,
    status: 'preview',
    requested_by: actor.userId,
    summary: { refreshable: preview.refreshable, reviewRequired: preview.reviewRequired },
  }).select('id').single();
  if (runError) throw sanitizeDbError(runError, 'action.shift-repair.create-run');
  if (!run) throw new Error('修復実行を作成できませんでした');

  let applied = 0;
  for (const item of preview.items.filter((entry) => entry.action === 'refresh_derived_staffs')) {
    const before = { hasSegments: item.hasSegments, hasSegmentStaffs: item.hasSegmentStaffs, hasDerivedStaffs: item.hasDerivedStaffs };
    const { error } = await supabaseAdmin.rpc('refresh_shift_staffs', { p_shift_id: item.shiftId });
    const afterHash = createHash('sha256').update(JSON.stringify({ shiftId: item.shiftId, repaired: true })).digest('hex');
    const { error: itemError } = await supabaseAdmin.from('maintenance_run_items').insert({
      run_id: run.id,
      resource_type: 'shift',
      resource_id: item.shiftId,
      action: 'refresh_derived_staffs',
      before_state: before,
      after_hash: afterHash,
      result: error ? 'failed' : 'applied',
    });
    if (itemError) throw sanitizeDbError(itemError, 'action.shift-repair.create-item');
    if (error) throw sanitizeDbError(error, 'action.shift-repair.refresh');
    applied++;
  }
  const { error: updateError } = await supabaseAdmin.from('maintenance_runs').update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', run.id);
  if (updateError) throw sanitizeDbError(updateError, 'action.shift-repair.complete-run');
  return { runId: run.id, applied, reviewRequired: preview.reviewRequired };
  });
}
