import 'server-only';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, supabaseAdmin } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';
import { computeOccurrenceSegmentDateTimes } from '@/utils/shiftRecurrence';

import { normalizeTimeForDb } from './helpers';
import { trySyncSilently } from './googleSyncInternal';
import type { ShiftPatternSegmentInput, ShiftPayload, ShiftUpdateData } from './types';

type ShiftStaffInsert = { shift_id: string; staff_id: string };
type PatternStaffInsert = { pattern_id: string; staff_id: string };

export type PatternSegmentRow = {
  id: string;
  pattern_id: string;
  service_type_id: string | null;
  start_time: string;
  end_time: string;
  sort_order: number;
  shift_pattern_segment_staffs?: Array<{
    staff_id: string;
    staff_role_id: string | null;
  }>;
};

export async function assertShiftsAccessible(shiftIds: string[]): Promise<void> {
  if (!shiftIds || shiftIds.length === 0) return;
  const { data, error } = await supabaseAdmin
    .from('shifts')
    .select('id, organization_id')
    .in('id', shiftIds);
  if (error) throw error;
  if ((data?.length || 0) !== shiftIds.length) throw new Error('対象シフトが見つかりません');

  const orgIds = Array.from(new Set((data || []).map((shift) => shift.organization_id)));
  for (const orgId of orgIds) {
    const ids = (data || [])
      .filter((shift) => shift.organization_id === orgId)
      .map((shift) => shift.id);
    await assertShiftPermission(orgId, 'delete', { shiftIds: ids });
  }
}

export async function softDeleteShiftIds(
  organizationId: string,
  shiftIds: string[],
  reason: string,
) {
  if (shiftIds.length === 0) return;
  const actor = await assertShiftPermission(organizationId, 'delete', { shiftIds });
  const policy = await getRetentionPolicy(organizationId, 'shift');
  const { error } = await supabaseAdmin.from('shifts').update({
    deleted_at: new Date().toISOString(),
    deleted_by: actor.userId,
    deletion_reason: reason,
    retention_until: retentionDeadline(policy.years),
    google_sync_status: 'synced',
    google_sync_error: null,
    google_synced_at: new Date().toISOString(),
  }).eq('organization_id', organizationId).in('id', shiftIds).is('deleted_at', null);
  if (error) throw error;
  await recordAuditEvent({
    organizationId,
    actorId: actor.userId,
    action: 'shift.bulk_soft_delete',
    resourceType: 'shift',
    reason,
    details: { shiftIds, count: shiftIds.length, legalBasis: policy.legalBasis },
  });
}

export async function upsertAssignmentsForStaffs(
  organizationId: string,
  clientId: string,
  staffIds: string[],
) {
  const { data: staffRows, error: staffError } = await supabaseAdmin
    .from('staffs')
    .select('id, user_id')
    .eq('organization_id', organizationId)
    .in('id', staffIds)
    .is('deleted_at', null);
  if (staffError) throw staffError;
  if (!staffRows || staffRows.length === 0) return;
  const { error: upsertError } = await supabaseAdmin.from('assignments').upsert(
    staffRows.map((staff) => ({
      client_id: clientId,
      staff_id: staff.id,
      helper_id: staff.user_id ?? null,
    })),
    { onConflict: 'client_id,staff_id', ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;
}

export async function replacePatternStaffs(patternId: string, staffIds: string[]) {
  await supabaseAdmin.from('shift_pattern_staffs').delete().eq('pattern_id', patternId);
  if (staffIds.length > 0) {
    const inserts: PatternStaffInsert[] = staffIds
      .map((staffId) => ({ pattern_id: patternId, staff_id: staffId }));
    const { error } = await supabaseAdmin.from('shift_pattern_staffs').insert(inserts);
    if (error) throw error;
  }
}

export async function replaceShiftStaffs(shiftId: string, staffIds: string[]) {
  await supabaseAdmin.from('shift_staffs').delete().eq('shift_id', shiftId);
  if (staffIds.length > 0) {
    const staffInserts: ShiftStaffInsert[] = staffIds
      .map((staffId) => ({ shift_id: shiftId, staff_id: staffId }));
    const { error } = await supabaseAdmin.from('shift_staffs').insert(staffInserts);
    if (error) throw error;
  }
}

export async function savePatternSegments(
  patternId: string,
  segments: ShiftPatternSegmentInput[],
) {
  const normalizedSegments = segments.map((segment, index) => ({
    ...segment,
    start_time: normalizeTimeForDb(segment.start_time),
    end_time: normalizeTimeForDb(segment.end_time),
    sort_order: index,
  }));

  const { error: deleteError } = await supabaseAdmin
    .from('shift_pattern_segments')
    .delete()
    .eq('pattern_id', patternId);
  if (deleteError) throw deleteError;
  if (normalizedSegments.length === 0) return;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('shift_pattern_segments')
    .insert(normalizedSegments.map((segment) => ({
      pattern_id: patternId,
      service_type_id: segment.service_type_id || null,
      start_time: segment.start_time,
      end_time: segment.end_time,
      sort_order: segment.sort_order ?? 0,
    })))
    .select('id');
  if (insertError || !inserted) throw insertError;

  const staffRows = inserted.flatMap((segment, index) => (
    (normalizedSegments[index].staffs ?? [])
      .filter((staff) => Boolean(staff.staff_id))
      .map((staff) => ({
        segment_id: segment.id,
        staff_id: staff.staff_id,
        staff_role_id: staff.staff_role_id || null,
      }))
  ));
  if (staffRows.length > 0) {
    const { error: staffError } = await supabaseAdmin
      .from('shift_pattern_segment_staffs')
      .insert(staffRows);
    if (staffError) throw staffError;
  }
}

export async function saveShiftSegmentsFromPattern(
  shiftId: string,
  patternSegments: PatternSegmentRow[] | null | undefined,
  occurrence: {
    year: number;
    month: number;
    day: number;
    parentStartTime: string;
    parentEndTime: string;
  },
  fallbackStaffIds: string[],
) {
  const { count: linkedReportCount, error: linkedReportError } = await supabaseAdmin
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('shift_id', shiftId)
    .is('deleted_at', null);
  if (linkedReportError) throw linkedReportError;
  if ((linkedReportCount ?? 0) > 0) return;

  const sourceSegments = patternSegments && patternSegments.length > 0
    ? patternSegments
    : [{
      id: '',
      pattern_id: '',
      service_type_id: null,
      start_time: occurrence.parentStartTime,
      end_time: occurrence.parentEndTime,
      sort_order: 0,
      shift_pattern_segment_staffs: fallbackStaffIds
        .map((staffId) => ({ staff_id: staffId, staff_role_id: null })),
    }];

  const { error: deleteError } = await supabaseAdmin
    .from('shift_segments')
    .delete()
    .eq('shift_id', shiftId);
  if (deleteError) throw deleteError;

  const segmentRows = sourceSegments.map((segment, index) => {
    const { startAt, endAt } = computeOccurrenceSegmentDateTimes(
      occurrence.year,
      occurrence.month,
      occurrence.day,
      occurrence.parentStartTime,
      occurrence.parentEndTime,
      segment.start_time,
      segment.end_time,
    );
    return {
      shift_id: shiftId,
      source_pattern_segment_id: segment.id || null,
      service_type_id: segment.service_type_id ?? null,
      start_at: startAt,
      end_at: endAt,
      sort_order: index,
    };
  });

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('shift_segments')
    .insert(segmentRows)
    .select('id');
  if (insertError || !inserted) throw insertError;

  const staffRows = inserted.flatMap((segment, index) => (
    (sourceSegments[index].shift_pattern_segment_staffs ?? [])
      .filter((staff) => Boolean(staff.staff_id))
      .map((staff) => ({
        segment_id: segment.id,
        staff_id: staff.staff_id,
        staff_role_id: staff.staff_role_id ?? null,
      }))
  ));
  if (staffRows.length > 0) {
    const { error: staffError } = await supabaseAdmin
      .from('shift_segment_staffs')
      .insert(staffRows);
    if (staffError) throw staffError;
  }
}

export async function createShiftInternal(
  payload: ShiftPayload,
  awaitSync: boolean | 'skip' = true,
) {
  try {
    const { data: shift, error: shiftError } = await supabaseAdmin.from('shifts').insert({
      organization_id: payload.organizationId,
      client_id: payload.clientId,
      title: payload.title,
      start_at: payload.startAt,
      end_at: payload.endAt,
      status: payload.status || 'published',
      pattern_id: payload.patternId || null,
      is_modified: payload.isModified ?? false,
      google_sync_status: 'pending_upsert',
      google_sync_error: null,
      google_synced_at: null,
    }).select('id').single();
    if (shiftError || !shift) throw new Error(shiftError?.message);

    if (awaitSync === 'skip') {
      // Intentionally skip calendar sync for bulk generation.
    } else if (awaitSync) {
      await trySyncSilently(payload.organizationId, shift.id, 'sync');
    } else {
      void trySyncSilently(payload.organizationId, shift.id, 'sync');
    }
    return { success: true, shiftId: shift.id };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

// 認可チェックを伴わない内部実装（呼び出し元で必ず先に検証すること）
export async function updateShiftInternal(
  shiftId: string,
  payload: Partial<ShiftPayload>,
  awaitSync: boolean | 'skip' = true,
) {
  try {
    const updateData: ShiftUpdateData = {};
    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.startAt !== undefined) updateData.start_at = payload.startAt;
    if (payload.endAt !== undefined) updateData.end_at = payload.endAt;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.cancelReason !== undefined) updateData.cancel_reason = payload.cancelReason;
    updateData.is_modified = payload.isModified ?? true;

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = new Date().toISOString();
      updateData.google_sync_status = 'pending_upsert';
      updateData.google_sync_error = null;
      updateData.google_synced_at = null;
      await supabaseAdmin.from('shifts').update(updateData).eq('id', shiftId);
    }

    const targetOrgId = payload.organizationId
      || (await supabaseAdmin.from('shifts').select('organization_id').eq('id', shiftId).single())
        .data?.organization_id;
    if (targetOrgId) {
      if (awaitSync === 'skip') {
        // Intentionally skip calendar sync for bulk generation.
      } else if (awaitSync) {
        await trySyncSilently(targetOrgId, shiftId, 'sync');
      } else {
        void trySyncSilently(targetOrgId, shiftId, 'sync');
      }
    }
    return { success: true };
  } catch (error) {
    console.error(error);
    throw error;
  }
}
