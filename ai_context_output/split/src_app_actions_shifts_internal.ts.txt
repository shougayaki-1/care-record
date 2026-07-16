import 'server-only';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, createSessionClient } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';
import { computeOccurrenceSegmentDateTimes } from '@/utils/shiftRecurrence';

import { normalizeTimeForDb } from './helpers';
import { trySyncSilently } from './googleSyncInternal';
import type { ShiftPatternSegmentInput, ShiftPayload, ShiftUpdateData } from './types';

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
  const supabase = await createSessionClient();
  const { data, error } = await supabase
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
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('soft_delete_shifts_atomic', {
    p_org_id: organizationId, p_shift_ids: shiftIds, p_reason: reason,
    p_retention_until: retentionDeadline(policy.years), p_sync_status: 'synced',
  });
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
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('upsert_shift_assignments_atomic', {
    p_org_id: organizationId, p_client_id: clientId, p_staff_ids: staffIds,
  });
  if (error) throw error;
}

export async function replacePatternStaffs(patternId: string, staffIds: string[]) {
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('replace_pattern_staffs_atomic', { p_pattern_id: patternId, p_staff_ids: staffIds });
  if (error) throw error;
}

export async function replaceShiftStaffs(shiftId: string, staffIds: string[]) {
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('replace_shift_staffs_atomic', { p_shift_id: shiftId, p_staff_ids: staffIds });
  if (error) throw error;
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

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('replace_pattern_segments_atomic', { p_pattern_id: patternId, p_segments: normalizedSegments });
  if (error) throw error;
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
      source_pattern_segment_id: segment.id || null,
      service_type_id: segment.service_type_id ?? null,
      start_at: startAt,
      end_at: endAt,
      sort_order: index,
      staffs: (segment.shift_pattern_segment_staffs ?? []).map((staff) => ({
        staff_id: staff.staff_id, staff_role_id: staff.staff_role_id ?? null,
      })),
    };
  });
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('replace_generated_shift_segments_atomic', { p_shift_id: shiftId, p_segments: segmentRows });
  if (error) throw error;
}

export async function createShiftInternal(
  payload: ShiftPayload,
  awaitSync: boolean | 'skip' = true,
) {
  try {
    const supabase = await createSessionClient();
    const { data: shift, error: shiftError } = await supabase.from('shifts').insert({
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
    const supabase = await createSessionClient();
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
      const { error } = await supabase.from('shifts').update(updateData).eq('id', shiftId);
      if (error) throw error;
    }

    const targetOrgId = payload.organizationId
      || (await supabase.from('shifts').select('organization_id').eq('id', shiftId).single())
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

export async function saveGeneratedShiftAtomic(
  shiftId: string | null,
  payload: ShiftPayload,
  patternSegments: PatternSegmentRow[] | null | undefined,
  occurrence: { year: number; month: number; day: number; parentStartTime: string; parentEndTime: string },
  fallbackStaffIds: string[],
) {
  const sourceSegments = patternSegments && patternSegments.length > 0
    ? patternSegments
    : [{ id: '', pattern_id: '', service_type_id: null, start_time: occurrence.parentStartTime,
        end_time: occurrence.parentEndTime, sort_order: 0,
        shift_pattern_segment_staffs: fallbackStaffIds.map((staffId) => ({ staff_id: staffId, staff_role_id: null })) }];
  const segments = sourceSegments.map((segment, index) => {
    const { startAt, endAt } = computeOccurrenceSegmentDateTimes(
      occurrence.year, occurrence.month, occurrence.day, occurrence.parentStartTime,
      occurrence.parentEndTime, segment.start_time, segment.end_time,
    );
    return { source_pattern_segment_id: segment.id || null, service_type_id: segment.service_type_id,
      start_at: startAt, end_at: endAt, sort_order: index,
      staffs: (segment.shift_pattern_segment_staffs ?? []).map((staff) => ({ staff_id: staff.staff_id, staff_role_id: staff.staff_role_id })) };
  });
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc('save_generated_shift_atomic', {
    p_shift_id: shiftId, p_org_id: payload.organizationId,
    p_payload: { client_id: payload.clientId, title: payload.title, start_at: payload.startAt,
      end_at: payload.endAt, status: payload.status ?? 'published', pattern_id: payload.patternId ?? null,
      is_modified: payload.isModified ?? false, segments },
  });
  if (error) throw error;
  return { success: true, shiftId: data as string };
}
