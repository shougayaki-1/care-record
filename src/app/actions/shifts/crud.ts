'use server';

import { ExpectedActionError, requireActionResult, sanitizeDbError, withActionResult } from '@/utils/errors';
import { emptyGoogleSyncStats, type SyncErrorKind } from '@/utils/googleSync';
import { logError, serializeError } from '@/utils/log';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, createSessionClient, getEffectivePermissions } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';

import { uniqueStaffIdsFromSegments } from './helpers';
import {
  assertShiftsAccessible,
  createShiftWithSegmentsAtomic,
  softDeleteShiftIds,
  upsertAssignmentsForStaffs,
  updateShiftInternal,
} from './internal';
import {
  processShiftsSequential,
  trySyncSilently,
} from './googleSyncInternal';
import type { ShiftPayload, ShiftQueryFilter } from './types';
import { buildShiftTitle } from '@/utils/shiftTitle';

async function getCurrentShiftTitle(
  shiftId: string,
  fallbackTitle?: string,
  targetClientId?: string,
): Promise<string | undefined> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase
    .from('shifts')
    .select('client_id, clients(name), shift_staffs(staffs(name))')
    .eq('id', shiftId)
    .single();
  if (error || !data) return fallbackTitle;

  let client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
  if (targetClientId && targetClientId !== data.client_id) {
      const { data: targetClient } = await supabase
          .from('clients')
          .select('name')
          .eq('id', targetClientId)
          .maybeSingle();
      client = targetClient ?? client;
  }
  const staffNames = (data.shift_staffs ?? []).flatMap((shiftStaff) => {
    const staff = Array.isArray(shiftStaff.staffs) ? shiftStaff.staffs[0] : shiftStaff.staffs;
    return staff?.name ? [staff.name] : [];
  });
  return client?.name ? buildShiftTitle(client.name, staffNames) : fallbackTitle;
}

// 認可チェックを伴う公開アクション
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
  return withActionResult('createShift', async () => {
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
  return withActionResult('updateShift', async () => {
      const supabase = await createSessionClient();
      const { data: existing, error: readError } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).maybeSingle();
      if (readError) throw sanitizeDbError(readError, 'action.shifts.target');
      const organizationId = existing?.organization_id as string | undefined;
      if (!organizationId) throw new ExpectedActionError('NOT_FOUND', 'シフトが見つかりません');
      const actor = await assertShiftPermission(organizationId, 'edit', { shiftId, clientId: payload.clientId });
      if (payload.organizationId && payload.organizationId !== organizationId) {
          throw new ExpectedActionError('VALIDATION_ERROR', 'シフトの事業所は変更できません');
      }
      if (payload.clientId !== undefined) {
          const { data: client, error: clientError } = await supabase
              .from('clients')
              .select('id')
              .eq('id', payload.clientId)
              .eq('organization_id', organizationId)
              .is('deleted_at', null)
              .maybeSingle();
          if (clientError) throw sanitizeDbError(clientError, 'action.shifts.client');
          if (!client) {
              throw new ExpectedActionError('VALIDATION_ERROR', '指定された利用者はこの事業所に所属していません');
          }
      }
      const title = await getCurrentShiftTitle(shiftId, payload.title, payload.clientId);
      const result = await updateShiftInternal(shiftId, { ...payload, organizationId, title }, awaitSync);
      const fields = Object.keys(payload).filter((field) => field !== 'segments');
      if (payload.segments !== undefined) fields.push('segments');
      await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'shift.update', resourceType: 'shift', resourceId: shiftId, details: { fields } });
      return result;
  });
}

export async function updateShiftTimeOnly(shiftId: string, startAt: string, endAt: string) {
  return withActionResult('updateShiftTimeOnly', async () => {
      const supabase = await createSessionClient();
      const { data: existing, error: readError } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).maybeSingle();
      if (readError) throw sanitizeDbError(readError, 'action.shifts.target');
      if (!existing?.organization_id) throw new ExpectedActionError('NOT_FOUND', 'シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { shiftId });
      try {
          const { data: updated, error } = await supabase.from('shifts').update({
              start_at: startAt,
              end_at: endAt,
              updated_at: new Date().toISOString(),
              is_modified: true,
              google_sync_status: 'pending_upsert',
              google_sync_error: null,
              google_synced_at: null
          }).eq('id', shiftId).eq('organization_id', actor.organizationId).is('deleted_at', null)
              .select('id').maybeSingle();
          if (error) throw sanitizeDbError(error, 'updateShiftTimeOnly');
          if (!updated) throw new ExpectedActionError('VALIDATION_ERROR', 'シフトを更新できませんでした。再読み込みしてお試しください。');

          await trySyncSilently(actor.organizationId, shiftId, 'sync');
          await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.time_update', resourceType: 'shift', resourceId: shiftId });
          return { success: true };
      } catch (error) { logError('updateShiftTimeOnly failed', { organizationId: actor.organizationId, error: serializeError(error) }); throw error; }
  });
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
  return withActionResult('toggleCancelShift', async () => {
      const supabase = await createSessionClient();
      const { data: existing, error: readError } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).maybeSingle();
      if (readError) throw sanitizeDbError(readError, 'action.shifts.target');
      if (!existing?.organization_id) throw new ExpectedActionError('NOT_FOUND', 'シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { shiftId });
      try {
          const status = isCancel ? 'cancelled' : 'published';
          const cancelReason = isCancel ? reason : null;
          const { data: updated, error } = await supabase.from('shifts').update({
              status,
              cancel_reason: cancelReason,
              updated_at: new Date().toISOString(),
              is_modified: true,
              google_sync_status: 'pending_upsert',
              google_sync_error: null,
              google_synced_at: null
          }).eq('id', shiftId).eq('organization_id', actor.organizationId).is('deleted_at', null)
              .select('id').maybeSingle();
          if (error) throw sanitizeDbError(error, 'toggleCancelShift');
          if (!updated) throw new ExpectedActionError('VALIDATION_ERROR', 'シフトを更新できませんでした。再読み込みしてお試しください。');

          await trySyncSilently(actor.organizationId, shiftId, 'sync');
          await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: isCancel ? 'shift.cancel' : 'shift.reopen', resourceType: 'shift', resourceId: shiftId, reason: isCancel ? reason : null });
          return { success: true };
      } catch (error) { logError('toggleCancelShift failed', { organizationId: actor.organizationId, error: serializeError(error) }); throw error; }
  });
}

export async function getShifts(organizationId: string, startDate: string, endDate: string, filter: ShiftQueryFilter = {}) {
  return withActionResult('getShifts', async () => {
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
          if (error) throw sanitizeDbError(error, 'action.shifts');
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


/** ローカル削除を確定してから、Google上の予定の削除を試みる。 */
export async function deleteShiftsBatch(organizationId: string, shiftIds: string[]) {
  return withActionResult('deleteShiftsBatch', async () => {
      const ids = [...new Set(shiftIds)];
      if (ids.length === 0) return { success: true, deleted: 0, failed: 0, errorKind: undefined as SyncErrorKind | undefined, ...emptyGoogleSyncStats() };
      await assertShiftPermission(organizationId, 'delete', { shiftIds: ids });
      await assertShiftsAccessible(ids);
      const supabase = await createSessionClient();
      const { data: shifts, error } = await supabase.from('shifts').select('id')
          .eq('organization_id', organizationId).in('id', ids).is('deleted_at', null);
      if (error) throw sanitizeDbError(error, 'deleteShiftsBatch');
      if (shifts?.length !== ids.length) throw new ExpectedActionError('NOT_FOUND', '対象シフトが見つかりません');

      // 保持方針の検証とDB削除が成功するまで、Googleには触れない。
      const deleted = await softDeleteShiftIds(organizationId, shifts.map(shift => shift.id), 'シフト削除');
      const outcome = await processShiftsSequential(organizationId, shifts, 'delete');
      return { success: true, deleted, failed: outcome.failed, errorKind: outcome.errorKind, ...outcome.stats };
  });
}

export async function deleteShift(shiftId: string) {
  return withActionResult('deleteShift', async () => {
      const supabase = await createSessionClient();
      const { data: existing, error } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).maybeSingle();
      if (error) throw sanitizeDbError(error, 'action.shifts.delete-target');
      if (!existing?.organization_id) throw new ExpectedActionError('NOT_FOUND', 'シフトが見つかりません');
      return requireActionResult(deleteShiftsBatch(existing.organization_id, [shiftId]));
  });
}

/**
 * Googleカレンダーの同期を伴わず、DBのシフトデータのみを一括削除する（一括消去時のパフォーマンス・エラー防止対策用）
 */
export async function deleteShiftsDbOnly(shiftIds: string[]) {
  return withActionResult('deleteShiftsDbOnly', async () => {
      await assertShiftsAccessible(shiftIds);
      const supabase = await createSessionClient();
      try {
          const { data: shifts, error: readError } = await supabase.from('shifts').select('id, organization_id').in('id', shiftIds);
          if (readError) throw sanitizeDbError(readError, 'deleteShiftsDbOnly');
          if ((shifts?.length ?? 0) !== shiftIds.length) throw new ExpectedActionError('NOT_FOUND', '対象シフトが見つかりません');
          const grouped = new Map<string, { id: string }[]>();
          for (const shift of shifts || []) grouped.set(shift.organization_id, [...(grouped.get(shift.organization_id) || []), { id: shift.id }]);
          for (const [orgId, ids] of grouped) {
              const targets = (ids || []).map((shift) => shift.id);
              const actor = await assertShiftPermission(orgId, 'delete', { shiftIds: targets });
              const policy = await getRetentionPolicy(orgId, 'shift');
              const { data: deleted, error } = await supabase.rpc('soft_delete_shifts_atomic', {
                  p_org_id: orgId, p_shift_ids: targets, p_reason: 'DB一括削除',
                  p_retention_until: retentionDeadline(policy.years), p_sync_status: 'pending_delete',
              });
              if (error) throw sanitizeDbError(error, 'deleteShiftsDbOnly');
              if (deleted !== targets.length) throw new ExpectedActionError('VALIDATION_ERROR', '対象シフトを削除できませんでした。再読み込みしてお試しください。');
              await recordAuditEvent({ organizationId: orgId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift', reason: 'DB一括削除', details: { shiftIds: targets } });
          }
          return { success: true };
      } catch (error) {
          // 複数組織にまたがるバッチのため、この時点で単一のorganizationIdは特定できない
          logError('Delete Shifts DB Only Error', { error: serializeError(error) });
          throw error;
      }
  });
}
