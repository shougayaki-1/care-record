'use server';

import { saveShiftSegments } from '../shiftSegments';
import { UserFacingError, withSafeError } from '@/utils/errors';
import { classifyGoogleError, emptyGoogleSyncStats, type SyncErrorKind } from '@/utils/googleSync';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, createSessionClient, getEffectivePermissions } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';

import { uniqueStaffIdsFromSegments } from './helpers';
import {
  assertShiftsAccessible,
  createShiftInternal,
  softDeleteShiftIds,
  upsertAssignmentsForStaffs,
  updateShiftInternal,
} from './internal';
import {
  markShiftGoogleSync,
  processShiftsSequential,
  syncToGoogleCalendarDirect,
  trySyncSilently,
} from './googleSyncInternal';
import type { ShiftPayload, ShiftQueryFilter } from './types';

// 認可チェックを伴う公開アクション
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
  return withSafeError('createShift', async () => {
      const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });

      // セグメントがある場合は shift_staffs が揃う前に同期が走らないよう、内部呼び出しでは同期をスキップする
      const internalSyncMode = (payload.segments && payload.segments.length > 0) ? 'skip' : awaitSync;
      const result = await createShiftInternal(payload, internalSyncMode);

      if (payload.segments && payload.segments.length > 0) {
          await saveShiftSegments(payload.organizationId, result.shiftId, payload.segments);
          // shift_staffs が揃った後で同期を実行する
          if (awaitSync !== 'skip') {
              if (awaitSync) {
                  await trySyncSilently(payload.organizationId, result.shiftId, 'sync');
              } else {
                  trySyncSilently(payload.organizationId, result.shiftId, 'sync');
              }
          }
      }

      // 自動アサイン: シフト作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
      if (payload.autoAssign && payload.segments && payload.segments.length > 0) {
          const staffIds = uniqueStaffIdsFromSegments(payload.segments);
          if (staffIds.length > 0) {
              await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, staffIds);
          }
      }

      await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift.create', resourceType: 'shift', resourceId: result.shiftId });
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
      const result = await updateShiftInternal(shiftId, payload, awaitSync);
      await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'shift.update', resourceType: 'shift', resourceId: shiftId, details: { fields: Object.keys(payload) } });
      return result;
  });
}

export async function updateShiftTimeOnly(shiftId: string, startAt: string, endAt: string) {
  return withSafeError('updateShiftTimeOnly', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      if (!existing?.organization_id) throw new Error('シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { shiftId });
      try {
          await supabase.from('shifts').update({
              start_at: startAt,
              end_at: endAt,
              updated_at: new Date().toISOString(),
              is_modified: true,
              google_sync_status: 'pending_upsert',
              google_sync_error: null,
              google_synced_at: null
          }).eq('id', shiftId);

          const { data } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
          if (data) await trySyncSilently(data.organization_id, shiftId, 'sync');
          await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.time_update', resourceType: 'shift', resourceId: shiftId });
          return { success: true };
      } catch (error) { console.error(error); throw error; }
  });
}

export async function toggleCancelShift(shiftId: string, isCancel: boolean, reason: string = '') {
  return withSafeError('toggleCancelShift', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      if (!existing?.organization_id) throw new Error('シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { shiftId });
      try {
          const status = isCancel ? 'cancelled' : 'published';
          const cancelReason = isCancel ? reason : null;
          await supabase.from('shifts').update({
              status,
              cancel_reason: cancelReason,
              updated_at: new Date().toISOString(),
              is_modified: true,
              google_sync_status: 'pending_upsert',
              google_sync_error: null,
              google_synced_at: null
          }).eq('id', shiftId);

          const { data } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
          if (data) await trySyncSilently(data.organization_id, shiftId, 'sync');
          await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: isCancel ? 'shift.cancel' : 'shift.reopen', resourceType: 'shift', resourceId: shiftId, reason: isCancel ? reason : null });
          return { success: true };
      } catch (error) { console.error(error); throw error; }
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
      } catch (error) { console.error(error); throw error; }
  });
}


/**
 * 指定したシフトID群を「Googleから削除成功した分のみDB削除」する安全なチャンク削除。
 * クライアントは件数が多い場合に分割して繰り返し呼ぶ（タイムアウト回避）。
 */
export async function deleteShiftsBatch(organizationId: string, shiftIds: string[]) {
  return withSafeError('deleteShiftsBatch', async () => {
      if (!shiftIds || shiftIds.length === 0) return { success: true, deleted: 0, failed: 0, errorKind: undefined as SyncErrorKind | undefined, ...emptyGoogleSyncStats() };
      await assertShiftPermission(organizationId, 'delete', { shiftIds });
      await assertShiftsAccessible(shiftIds);
      const supabase = await createSessionClient();
      try {
          const { data: shifts } = await supabase
              .from('shifts')
              .select('id')
              .eq('organization_id', organizationId)
              .in('id', shiftIds);

          if (!shifts || shifts.length === 0) return { success: true, deleted: 0, failed: 0, errorKind: undefined as SyncErrorKind | undefined, ...emptyGoogleSyncStats() };

          const outcome = await processShiftsSequential(organizationId, shifts, 'delete');
          const deletableIds = shifts.map(s => s.id).filter(id => !outcome.failedIds.includes(id));

          if (deletableIds.length > 0) {
              await softDeleteShiftIds(organizationId, deletableIds, 'シフト一括削除');
          }
          return { success: true, deleted: deletableIds.length, failed: outcome.failed, errorKind: outcome.errorKind, ...outcome.stats };
      } catch (error) {
          console.error('Delete Shifts Batch Error:', error);
          throw error;
      }
  });
}

export async function deleteShiftCompletely(shiftId: string) {
  return withSafeError('deleteShiftCompletely', async () => {
      const supabase = await createSessionClient();
      const { data: existing } = await supabase.from('shifts').select('organization_id').eq('id', shiftId).single();
      if (!existing?.organization_id) throw new Error('シフトが見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'delete', { shiftId });
      try {
          const { data: shiftData } = await supabase
              .from('shifts')
              .select('organization_id')
              .eq('id', shiftId)
              .single();

          if (shiftData) {
              await syncToGoogleCalendarDirect(shiftData.organization_id, shiftId, 'delete');
          }

          const policy = await getRetentionPolicy(actor.organizationId, 'shift');
          const { error } = await supabase.from('shifts').update({
              deleted_at: new Date().toISOString(), deleted_by: actor.userId,
              deletion_reason: '管理者による削除', retention_until: retentionDeadline(policy.years),
              google_sync_status: 'synced', google_sync_error: null, google_synced_at: new Date().toISOString(),
          }).eq('id', shiftId).is('deleted_at', null);

          if (error) throw error;
          await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift.soft_delete', resourceType: 'shift', resourceId: shiftId, reason: '管理者による削除', details: { legalBasis: policy.legalBasis } });
          return { success: true };
      } catch (error) {
          const se = classifyGoogleError(error);
          await markShiftGoogleSync(shiftId, 'failed', { error: se.message }).catch(console.error);
          console.error('Delete Shift Completely Error:', error);
          throw error;
      }
  });
}

/**
 * Googleカレンダーの同期を伴わず、DBのシフトデータのみを一括削除する（一括消去時のパフォーマンス・エラー防止対策用）
 */
export async function deleteShiftsDbOnly(shiftIds: string[]) {
  return withSafeError('deleteShiftsDbOnly', async () => {
      await assertShiftsAccessible(shiftIds);
      const supabase = await createSessionClient();
      try {
          const { data: shifts } = await supabase.from('shifts').select('id, organization_id').in('id', shiftIds);
          const grouped = new Map<string, { id: string }[]>();
          for (const shift of shifts || []) grouped.set(shift.organization_id, [...(grouped.get(shift.organization_id) || []), { id: shift.id }]);
          for (const [orgId, ids] of grouped) {
              const targets = (ids || []).map((shift) => shift.id);
              const actor = await assertShiftPermission(orgId, 'delete', { shiftIds: targets });
              const policy = await getRetentionPolicy(orgId, 'shift');
              const { error } = await supabase.from('shifts').update({
                  deleted_at: new Date().toISOString(), deleted_by: actor.userId,
                  deletion_reason: 'DB一括削除', retention_until: retentionDeadline(policy.years),
                  google_sync_status: 'pending_delete', google_sync_error: null, google_synced_at: null,
              }).in('id', targets).is('deleted_at', null);
              if (error) throw error;
              await recordAuditEvent({ organizationId: orgId, actorId: actor.userId, action: 'shift.bulk_soft_delete', resourceType: 'shift', reason: 'DB一括削除', details: { shiftIds: targets } });
          }
          return { success: true };
      } catch (error) {
          console.error('Delete Shifts DB Only Error:', error);
          throw error;
      }
  });
}
