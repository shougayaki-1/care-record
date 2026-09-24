import 'server-only';

import { sanitizeDbError, UserFacingError } from '@/utils/errors';
import { logError, serializeError } from '@/utils/log';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, createSessionClient } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';
import { computeOccurrenceSegmentDateTimes } from '@/utils/shiftRecurrence';
import { asJson, asNullableRpcArg } from '@/types/json';

import type { ShiftPayload } from './types';

// GAP-01: atomic RPC（update_shift_*_atomic / delete_shift_atomic）が返す
// 0行時の内訳コード。0行を成功として扱わず、可能な範囲で理由を区別する。
const SHIFT_WRITE_OUTCOME_MESSAGES: Record<string, string> = {
  not_found: 'シフトが見つかりません',
  deleted: 'このシフトは削除済みのため操作できません',
  conflict: '他の操作と競合しました。最新の状態を確認して再度お試しください',
};

export function shiftWriteFailureMessage(outcome: string): string {
  return SHIFT_WRITE_OUTCOME_MESSAGES[outcome] ?? SHIFT_WRITE_OUTCOME_MESSAGES.conflict;
}

const SHIFT_DELETE_OUTCOME_MESSAGES: Record<string, string> = {
  not_found: 'シフトが見つかりません',
  already_deleted: 'このシフトはすでに削除されています',
  conflict: '他の操作と競合しました。最新の状態を確認して再度お試しください',
};

export function shiftDeleteFailureMessage(outcome: string): string {
  return SHIFT_DELETE_OUTCOME_MESSAGES[outcome] ?? SHIFT_DELETE_OUTCOME_MESSAGES.conflict;
}

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

export type CheckedBulkDeleteResult = {
  requested: number;
  matched: number;
  deleted: number;
  already_deleted: number;
  failed: number;
};

export async function softDeleteShiftIds(
  organizationId: string,
  shiftIds: string[],
  reason: string,
  syncStatus: 'synced' | 'pending_delete' = 'pending_delete',
): Promise<CheckedBulkDeleteResult> {
  if (shiftIds.length === 0) {
    return { requested: 0, matched: 0, deleted: 0, already_deleted: 0, failed: 0 };
  }
  // The checked RPC is deliberately idempotent and must be reachable for a
  // retry whose rows are already soft-deleted.  Normal SELECT RLS hides those
  // rows, so the permission helper resolves the tenant with includeDeleted;
  // the SECURITY DEFINER RPC still re-checks the same-org/delete-all boundary.
  const actor = await assertShiftPermission(organizationId, 'delete', { shiftIds, includeDeleted: true });
  const policy = await getRetentionPolicy(organizationId, 'shift');
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc('soft_delete_shifts_checked', {
    p_org_id: organizationId, p_shift_ids: shiftIds, p_reason: reason,
    p_retention_until: retentionDeadline(policy.years), p_sync_status: syncStatus,
  });
  if (error) {
    await recordAuditEvent({
      organizationId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift',
      reason, outcome: 'failure', details: { shiftIds, requested: shiftIds.length, errorType: error.code ?? 'unknown' },
    });
    throw sanitizeDbError(error, 'action.shifts.bulkSoftDelete');
  }
  const result = data as CheckedBulkDeleteResult | null;
  if (!result
    || result.matched !== result.requested
    || result.deleted + result.already_deleted !== result.requested
    || result.failed !== 0) {
    await recordAuditEvent({
      organizationId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift',
      reason, outcome: 'failure', details: { shiftIds, requested: shiftIds.length, result: data ?? null },
    });
    throw new UserFacingError('対象シフトを削除できませんでした。最新の状態を確認してください');
  }
  if (result.deleted > 0) {
    await recordAuditEvent({
      organizationId,
      actorId: actor.userId,
      action: 'shift.bulk_soft_delete',
      resourceType: 'shift',
      reason,
      details: {
        shiftIds,
        requested: result.requested,
        matched: result.matched,
        deleted: result.deleted,
        alreadyDeleted: result.already_deleted,
        failed: result.failed,
        legalBasis: policy.legalBasis,
      },
    });
  }
  return result;
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

export async function createShiftWithSegmentsAtomic(payload: ShiftPayload) {
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc('create_shift_with_segments_atomic', {
      p_org_id: payload.organizationId,
      p_payload: asJson({
        client_id: payload.clientId,
        title: payload.title,
        start_at: payload.startAt,
        end_at: payload.endAt,
        status: payload.status ?? 'published',
        pattern_id: payload.patternId ?? null,
        is_modified: payload.isModified ?? false,
        segments: payload.segments ?? [],
      }),
    });
    if (error || !data) throw error ?? new Error('シフトの作成に失敗しました');
    return { success: true, shiftId: data };
  } catch (error) {
    logError('createShiftWithSegmentsAtomic failed', { organizationId: payload.organizationId, error: serializeError(error) });
    throw error;
  }
}

// 認可チェックを伴わない内部実装（呼び出し元で必ず先に assertShiftPermission 等を検証すること）。
// GAP-01: 直接 UPDATE ではなく atomic RPC + GET DIAGNOSTICS ROW_COUNT で成功を確認する。
export async function updateShiftInternal(
  shiftId: string,
  payload: Partial<ShiftPayload>,
  _awaitSync: boolean | 'skip' = true,
): Promise<{ success: true }> {
  // Kept for the existing public call contract; sync ownership moved to the
  // audited public Action so this helper cannot start Google work early.
  void _awaitSync;
  const supabase = await createSessionClient();
  const fieldPayload: Record<string, unknown> = {};
  if (payload.clientId !== undefined) fieldPayload.client_id = payload.clientId;
  if (payload.title !== undefined) fieldPayload.title = payload.title;
  if (payload.startAt !== undefined) fieldPayload.start_at = payload.startAt;
  if (payload.endAt !== undefined) fieldPayload.end_at = payload.endAt;
  if (payload.status !== undefined) fieldPayload.status = payload.status;
  if (payload.cancelReason !== undefined) fieldPayload.cancel_reason = payload.cancelReason;
  fieldPayload.is_modified = payload.isModified ?? true;

  const targetOrgId = payload.organizationId
    ?? (await supabase.from('shifts').select('organization_id').eq('id', shiftId).single()).data?.organization_id;
  if (!targetOrgId) throw new UserFacingError('シフトが見つかりません');

  const { data: outcome, error } = await supabase.rpc('update_shift_with_segments_atomic', {
    p_org_id: targetOrgId,
    p_shift_id: shiftId,
    p_payload: asJson(fieldPayload),
    p_replace_segments: payload.segments !== undefined,
    p_segments: payload.segments === undefined ? null : asJson(payload.segments),
  });
  if (error) {
    logError('updateShiftInternal failed', { organizationId: targetOrgId, error: serializeError(error) });
    throw sanitizeDbError(error, 'action.shifts.updateFields');
  }
  if (outcome !== 'updated') throw new UserFacingError(shiftWriteFailureMessage(String(outcome)));

  // Calendar sync is intentionally owned by the public Action.  It must not
  // begin until that Action has written its success audit event.
  return { success: true };
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
    p_shift_id: asNullableRpcArg<string>(shiftId), p_org_id: payload.organizationId,
    p_payload: asJson({ client_id: payload.clientId, title: payload.title, start_at: payload.startAt,
      end_at: payload.endAt, status: payload.status ?? 'published', pattern_id: payload.patternId ?? null,
      is_modified: payload.isModified ?? false, segments }),
  });
  if (error) throw error;
  return { success: true, shiftId: data as string };
}
