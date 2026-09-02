'use server';

import { sanitizeDbError, UserFacingError, withSafeError } from '@/utils/errors';
import { emptyGoogleSyncStats, type SyncErrorKind } from '@/utils/googleSync';
import { logError, serializeError } from '@/utils/log';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, createSessionClient, getEffectivePermissions } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';

import { uniqueStaffIdsFromSegments } from './helpers';
import {
  assertShiftsAccessible,
  createShiftWithSegmentsAtomic,
  shiftDeleteFailureMessage,
  shiftWriteFailureMessage,
  softDeleteShiftIds,
  upsertAssignmentsForStaffs,
  updateShiftInternal,
} from './internal';
import {
  processShiftsSequential,
  trySyncSilently,
} from './googleSyncInternal';
import type { ShiftPayload, ShiftQueryFilter } from './types';

// 認可チェックを伴う公開アクション
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
  return withSafeError('createShift', async () => {
      const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });

      const result = await createShiftWithSegmentsAtomic(payload);

      // 自動アサイン: シフト作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
      if (payload.autoAssign && payload.segments && payload.segments.length > 0) {
          const staffIds = uniqueStaffIdsFromSegments(payload.segments);
          if (staffIds.length > 0) {
              await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, staffIds);
          }
      }

      await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift.create', resourceType: 'shift', resourceId: result.shiftId });
      if (awaitSync !== 'skip') {
          if (awaitSync) {
              await trySyncSilently(payload.organizationId, result.shiftId, 'sync');
          } else {
              void trySyncSilently(payload.organizationId, result.shiftId, 'sync');
          }
      }
      return result;
  });
}

// 認可チェックを伴う公開アクション
export async function updateShift(shiftId: string, payload: Partial<ShiftPayload>, awaitSync: boolean | 'skip' = true) {
  return withSafeError('updateShift', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      const organizationId = existing?.organization_id as string | undefined;
      if (!organizationId) throw new Error('シフトが見つかりません');
      const actor = await assertShiftPermission(organizationId, 'edit', { shiftId, clientId: payload.clientId });
      if (payload.organizationId && payload.organizationId !== organizationId) {
          throw new UserFacingError('シフトの事業所は変更できません');
      }
      if (payload.clientId !== undefined) {
          const { data: client, error: clientError } = await supabase
              .from('clients')
              .select('id')
              .eq('id', payload.clientId)
              .eq('organization_id', organizationId)
              .is('deleted_at', null)
              .maybeSingle();
          if (clientError || !client) {
              throw new UserFacingError('指定された利用者はこの事業所に所属していません');
          }
      }
      const fields = Object.keys(payload).filter((field) => field !== 'segments');
      if (payload.segments !== undefined) fields.push('segments');
      let result: { success: true };
      try {
          result = await updateShiftInternal(shiftId, payload, awaitSync);
      } catch (error) {
          await recordAuditEvent({
              organizationId, actorId: actor.userId, action: 'shift.update', resourceType: 'shift', resourceId: shiftId,
              outcome: 'failure', details: { fields, reason: error instanceof UserFacingError ? error.message : 'db_error' },
          });
          throw error;
      }
      await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'shift.update', resourceType: 'shift', resourceId: shiftId, details: { fields } });
      if (awaitSync !== 'skip') {
          if (awaitSync) await trySyncSilently(organizationId, shiftId, 'sync');
          else void trySyncSilently(organizationId, shiftId, 'sync');
      }
      return result;
  });
}

export async function updateShiftTimeOnly(shiftId: string, startAt: string, endAt: string) {
  return withSafeError('updateShiftTimeOnly', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      if (!existing?.organization_id) throw new UserFacingError('シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { shiftId });

      const { data: outcome, error } = await supabase.rpc('update_shift_time_atomic', {
          p_org_id: actor.organizationId, p_shift_id: shiftId, p_start_at: startAt, p_end_at: endAt,
      });
      if (error) {
          await recordAuditEvent({
              organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.time_update', resourceType: 'shift',
              resourceId: shiftId, outcome: 'failure', details: { errorType: error.code ?? 'unknown' },
          });
          throw sanitizeDbError(error, 'action.shifts.updateTimeOnly');
      }
      if (outcome !== 'updated') {
          await recordAuditEvent({
              organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.time_update', resourceType: 'shift',
              resourceId: shiftId, outcome: 'failure', details: { reasonCode: outcome },
          });
          throw new UserFacingError(shiftWriteFailureMessage(String(outcome)));
      }
      await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.time_update', resourceType: 'shift', resourceId: shiftId });
      await trySyncSilently(actor.organizationId, shiftId, 'sync');
      return { success: true };
  });
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
  return withSafeError('toggleCancelShift', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      if (!existing?.organization_id) throw new UserFacingError('シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { shiftId });
      const auditAction = isCancel ? 'shift.cancel' : 'shift.reopen';

      const { data: outcome, error } = await supabase.rpc('toggle_cancel_shift_atomic', {
          p_org_id: actor.organizationId, p_shift_id: shiftId, p_is_cancel: isCancel, p_reason: reason,
      });
      if (error) {
          await recordAuditEvent({
              organizationId: actor.organizationId, actorId: actor.userId, action: auditAction, resourceType: 'shift',
              resourceId: shiftId, reason: isCancel ? reason : null, outcome: 'failure', details: { errorType: error.code ?? 'unknown' },
          });
          throw sanitizeDbError(error, 'action.shifts.toggleCancel');
      }
      if (outcome !== 'updated') {
          await recordAuditEvent({
              organizationId: actor.organizationId, actorId: actor.userId, action: auditAction, resourceType: 'shift',
              resourceId: shiftId, reason: isCancel ? reason : null, outcome: 'failure', details: { reasonCode: outcome },
          });
          throw new UserFacingError(shiftWriteFailureMessage(String(outcome)));
      }
      await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: auditAction, resourceType: 'shift', resourceId: shiftId, reason: isCancel ? reason : null });
      await trySyncSilently(actor.organizationId, shiftId, 'sync');
      return { success: true };
  });
}

export async function getShifts(organizationId: string, startDate: string, endDate: string, filter: ShiftQueryFilter = {}) {
  return withSafeError('getShifts', async () => {
      const actor = await assertShiftPermission(organizationId, 'view', { requireAllScope: false, clientId: filter.clientId || undefined });
      const supabase = await createSessionClient();
      try {
          const staffRelation = filter.staffId
              ? 'shift_staffs!inner (staff_id, staffs (name))'
              : 'shift_staffs (staff_id, staffs (name))';
          let query = supabase.from('shifts').select(`
              id,
              organization_id,
              client_id,
              title,
              start_at,
              end_at,
              status,
              cancel_reason,
              clients (id, name),
              ${staffRelation},
              report_shifts (shift_id, is_primary, reports (id, status, deleted_at))
          `).eq('organization_id', organizationId)
              .is('deleted_at', null)
              .lt('start_at', endDate)
              .gt('end_at', startDate)
              .order('start_at', { ascending: false });
          if (filter.staffId) query = query.eq('shift_staffs.staff_id', filter.staffId);
          if (filter.clientId) query = query.eq('client_id', filter.clientId);

          const { data, error } = await query;
          if (error) throw error;
          const withReportStatuses = (data ?? []).map(shift => {
              const reportShifts = Array.isArray(shift.report_shifts) ? shift.report_shifts : [];
              return {
                  ...shift,
                  report_statuses: reportShifts.flatMap((rs: { shift_id: string; is_primary: boolean; reports: { id: string; status: string | null; deleted_at: string | null } | { id: string; status: string | null; deleted_at: string | null }[] | null }) => {
                      const r = Array.isArray(rs.reports) ? rs.reports[0] : rs.reports;
                      if (!r || r.deleted_at) return [];
                      return [{ id: r.id, status: r.status, is_primary: rs.is_primary }];
                  }),
              };
          });
          if (actor.isOwner) return withReportStatuses;
          const { permissions } = await getEffectivePermissions(organizationId, actor.userId);
          if (permissions.shifts.view === 'all') return withReportStatuses;
          const staffId = actor.staffId;
          const assignedClientIds = new Set(actor.clientIds);
          return (withReportStatuses || []).filter((shift) => {
              const clientId = shift.client_id as string;
              const shiftStaffs = (shift.shift_staffs || []) as Array<{ staff_id: string | null }>;
              return assignedClientIds.has(clientId) || Boolean(staffId && shiftStaffs.some((staff) => staff.staff_id === staffId));
          });
      } catch (error) { logError('getShifts failed', { organizationId, error: serializeError(error) }); throw error; }
  });
}


/**
 * 指定したシフトID群をDB-firstで論理削除する安全なチャンク削除。
 * クライアントは件数が多い場合に分割して繰り返し呼ぶ（タイムアウト回避）。
 */
export async function deleteShiftsBatch(organizationId: string, shiftIds: string[]) {
  return withSafeError('deleteShiftsBatch', async () => {
      if (!shiftIds || shiftIds.length === 0) {
          return {
              success: true,
              deleted: 0,
              alreadyDeleted: 0,
              noop: true,
              pending: false,
              failed: 0,
              errorKind: undefined as SyncErrorKind | undefined,
              ...emptyGoogleSyncStats(),
          };
      }
      try {
          const result = await softDeleteShiftIds(organizationId, shiftIds, 'シフト一括削除', 'pending_delete');
          // A retry after a prior DB commit may be all already_deleted, but
          // must still reach Google cleanup through the deleted-sync boundary.
          const deletedIds = Array.from(new Set(shiftIds));
          const outcome = deletedIds.length > 0
              ? await processShiftsSequential(organizationId, deletedIds.map((id) => ({ id })), 'delete')
              : { succeeded: 0, failed: 0, failedIds: [], stats: emptyGoogleSyncStats(), errorKind: undefined };
          return {
              success: true,
              deleted: result.deleted,
              alreadyDeleted: result.already_deleted,
              noop: result.deleted === 0,
              pending: outcome.errorKind === 'skipped',
              failed: outcome.failed,
              errorKind: outcome.errorKind,
              ...outcome.stats,
          };
      } catch (error) {
          logError('Delete Shifts Batch Error', { organizationId, error: serializeError(error) });
          throw error;
      }
  });
}

// GAP-01: DB mutation → 成功確認（atomic RPC + ROW_COUNT）→ audit → Google Calendar sync の順に統一する。
// Google同期は syncステータスをpending化した上でtrySyncSilently（失敗してもDB削除自体は失敗にしない）に委ねる。
export async function deleteShiftCompletely(shiftId: string) {
  return withSafeError('deleteShiftCompletely', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      if (!existing?.organization_id) throw new UserFacingError('シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'delete', { shiftId });
      const policy = await getRetentionPolicy(actor.organizationId, 'shift');

      const { data: outcome, error } = await supabase.rpc('delete_shift_atomic', {
          p_org_id: actor.organizationId, p_shift_id: shiftId, p_reason: '管理者による削除',
          p_retention_until: retentionDeadline(policy.years), p_sync_status: 'pending_delete',
      });
      if (error) {
          await recordAuditEvent({
              organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.soft_delete', resourceType: 'shift',
              resourceId: shiftId, reason: '管理者による削除', outcome: 'failure', details: { errorType: error.code ?? 'unknown' },
          });
          throw sanitizeDbError(error, 'action.shifts.deleteCompletely');
      }
      if (outcome !== 'deleted') {
          await recordAuditEvent({
              organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.soft_delete', resourceType: 'shift',
              resourceId: shiftId, reason: '管理者による削除', outcome: 'failure', details: { reasonCode: outcome },
          });
          throw new UserFacingError(shiftDeleteFailureMessage(String(outcome)));
      }
      await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.soft_delete', resourceType: 'shift', resourceId: shiftId, reason: '管理者による削除', details: { legalBasis: policy.legalBasis } });
      const googleSync = await trySyncSilently(actor.organizationId, shiftId, 'delete');
      return { success: true, googleSync };
  });
}

/**
 * Googleカレンダーの同期を伴わず、DBのシフトデータのみを一括削除する（一括消去時のパフォーマンス・エラー防止対策用）
 */
export async function deleteShiftsDbOnly(shiftIds: string[]) {
  return withSafeError('deleteShiftsDbOnly', async () => {
      await assertShiftsAccessible(shiftIds);
      const supabase = await createSessionClient();
      const { data: shifts } = await supabase.from('shifts').select('id, organization_id').in('id', shiftIds);
      const grouped = new Map<string, { id: string }[]>();
      for (const shift of shifts || []) grouped.set(shift.organization_id, [...(grouped.get(shift.organization_id) || []), { id: shift.id }]);
      let totalDeleted = 0;
      for (const [orgId, ids] of grouped) {
          const targets = (ids || []).map((shift) => shift.id);
          const actor = await assertShiftPermission(orgId, 'delete', { shiftIds: targets });
          const policy = await getRetentionPolicy(orgId, 'shift');
          const { data: deleteResult, error } = await supabase.rpc('soft_delete_shifts_checked', {
              p_org_id: orgId, p_shift_ids: targets, p_reason: 'DB一括削除',
              p_retention_until: retentionDeadline(policy.years), p_sync_status: 'pending_delete',
          });
          if (error) {
              await recordAuditEvent({
                  organizationId: orgId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift',
                  reason: 'DB一括削除', outcome: 'failure', details: { shiftIds: targets, errorType: error.code ?? 'unknown' },
              });
              logError('Delete Shifts DB Only Error', { organizationId: orgId, error: serializeError(error) });
              throw sanitizeDbError(error, 'action.shifts.deleteDbOnly');
          }
          const result = deleteResult as { requested: number; matched: number; deleted: number; already_deleted: number; failed: number } | null;
          if (!result || result.matched !== result.requested || result.deleted + result.already_deleted !== result.requested || result.failed !== 0) {
              await recordAuditEvent({
                  organizationId: orgId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift',
                  reason: 'DB一括削除', outcome: 'failure', details: { shiftIds: targets, result: deleteResult ?? null },
              });
              throw new UserFacingError('対象シフトを削除できませんでした。最新の状態を確認してください');
          }
          totalDeleted += result.deleted;
          if (result.deleted > 0) {
              await recordAuditEvent({ organizationId: orgId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift', reason: 'DB一括削除', details: { shiftIds: targets, requested: result.requested, matched: result.matched, deleted: result.deleted, alreadyDeleted: result.already_deleted, failed: result.failed } });
          }
      }
      return { success: true, deleted: totalDeleted };
  });
}
