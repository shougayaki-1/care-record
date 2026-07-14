'use server';

import { type calendar_v3, google } from 'googleapis';

import { logExternalError, sanitizeExternalError, withSafeError } from '@/utils/errors';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';
import { decryptGoogleToken } from '@/utils/googleTokenCrypto';
import {
  GOOGLE_PROP_ORG_ID,
  GOOGLE_PROP_SHIFT_ID,
  buildGoogleEventBody,
  choosePrimaryGoogleEvent,
  classifyGoogleError,
  emptyGoogleSyncStats,
  getEventBodySignature,
  getGoogleEventPrivateProp,
  getLegacyEventSignature,
  type ShiftForGoogle,
  type SyncErrorKind,
} from '@/utils/googleSync';
import { assertShiftPermission, supabaseAdmin } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';

import {
  deleteDuplicateGoogleEvents,
  deleteGoogleEventIfExists,
  listAllActiveGoogleEvents,
  markShiftGoogleSync,
  processShiftsSequential,
  syncToGoogleCalendarDirect,
  withRetry,
  type GoogleCalendarClient,
} from './googleSyncInternal';
import type { RepairGoogleCalendarSyncOptions } from './types';

export async function getSyncStatus(organizationId: string) {
  return withSafeError('getSyncStatus', async () => {
      await assertShiftPermission(organizationId, 'edit', { requireAllScope: true });
      const { data: orgData } = await supabaseAdmin
          .from('organizations')
          .select('google_calendar_id, google_refresh_token')
          .eq('id', organizationId)
          .single();

      const connected = !!(orgData?.google_calendar_id && orgData?.google_refresh_token);

      const { count: total } = await supabaseAdmin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .is('deleted_at', null);

      const { count: unsynced } = await supabaseAdmin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)');

      return { connected, total: total || 0, unsynced: unsynced || 0 };
  });
}

/**
 * 未同期（google_event_id IS NULL）のシフトを最大 limit 件だけ同期する。
 * サーバー側で完結する短時間バッチ。残件数を返すので、クライアントは
 * remaining が 0 になるまで繰り返し呼ぶ（タイムアウト回避＆再開可能）。
 */
export async function syncUnsyncedBatch(organizationId: string, limit = 20) {
  return withSafeError('syncUnsyncedBatch', async () => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
          throw new Error('同期件数が不正です');
      }
      const actor = await assertShiftPermission(organizationId, 'edit', { requireAllScope: true });
      const status = await getSyncStatus(organizationId);
      if (!status.connected) {
          return { processed: 0, succeeded: 0, failed: 0, remaining: status.unsynced, errorKind: 'skipped' as SyncErrorKind, connected: false };
      }

      const { data: shifts } = await supabaseAdmin
          .from('shifts')
          .select('id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)')
          .limit(limit);

      if (!shifts || shifts.length === 0) {
          return { processed: 0, succeeded: 0, failed: 0, remaining: 0, connected: true, ...emptyGoogleSyncStats() };
      }

      const outcome = await processShiftsSequential(organizationId, shifts, 'sync');

      await recordAuditEvent({
          organizationId, actorId: actor.userId, action: 'integration.calendar.sync', resourceType: 'organization', resourceId: organizationId,
          details: { mode: 'unsynced_batch', processed: shifts.length, succeeded: outcome.succeeded, failed: outcome.failed },
      });

      // 同期後の残件数を再取得（成功分は google_event_id が埋まり減る）
      const { count: remaining } = await supabaseAdmin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)');

      return {
          processed: shifts.length,
          succeeded: outcome.succeeded,
          failed: outcome.failed,
          remaining: remaining || 0,
          ...outcome.stats,
          errorKind: outcome.errorKind,
          connected: true
      };
  });
}

/**
 * 全シフトを強制再同期するためのチャンク処理。
 * id 昇順で cursor より後ろを最大 limit 件処理し、次回用カーソルと残件数を返す。
 * クライアントは remaining が 0 になるまで nextCursor を渡して繰り返す。
 */
export async function forceSyncBatch(organizationId: string, cursor: string | null, limit = 20) {
  return withSafeError('forceSyncBatch', async () => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
          throw new Error('同期件数が不正です');
      }
      const actor = await assertShiftPermission(organizationId, 'edit', { requireAllScope: true });
      const status = await getSyncStatus(organizationId);
      if (!status.connected) {
          return { processed: 0, succeeded: 0, failed: 0, nextCursor: cursor, remaining: 0, errorKind: 'skipped' as SyncErrorKind, connected: false };
      }

      let query = supabaseAdmin
          .from('shifts')
          .select('id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .limit(limit);
      if (cursor) query = query.gt('id', cursor);

      const { data: shifts } = await query;

      if (!shifts || shifts.length === 0) {
          return { processed: 0, succeeded: 0, failed: 0, nextCursor: cursor, remaining: 0, connected: true, ...emptyGoogleSyncStats() };
      }

      const outcome = await processShiftsSequential(organizationId, shifts, 'sync');
      await recordAuditEvent({
          organizationId, actorId: actor.userId, action: 'integration.calendar.sync', resourceType: 'organization', resourceId: organizationId,
          details: { mode: 'force_batch', processed: shifts.length, succeeded: outcome.succeeded, failed: outcome.failed },
      });
      const nextCursor = shifts[shifts.length - 1].id;

      const { count: remaining } = await supabaseAdmin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .gt('id', nextCursor);

      return {
          processed: shifts.length,
          succeeded: outcome.succeeded,
          failed: outcome.failed,
          nextCursor,
          remaining: remaining || 0,
          ...outcome.stats,
          errorKind: outcome.errorKind,
          connected: true
      };
  });
}

export async function repairGoogleCalendarSync(organizationId: string, options: RepairGoogleCalendarSyncOptions = {}) {
  return withSafeError('repairGoogleCalendarSync', async () => {
      const actor = await assertShiftPermission(organizationId, 'edit', { requireAllScope: true });
      const limit = options.limit && Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 5000) : 5000;

      const { data: orgData } = await supabaseAdmin
          .from('organizations')
          .select('google_calendar_id, google_refresh_token')
          .eq('id', organizationId)
          .single();
      if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) {
          return { processed: 0, succeeded: 0, failed: 0, connected: false, errorKind: 'skipped' as SyncErrorKind, failedIds: [] as string[], ...emptyGoogleSyncStats() };
      }

      let calendarApi: GoogleCalendarClient;
      let allEvents: calendar_v3.Schema$Event[];
      try {
          const oauth2Client = getGoogleOAuthClient();
          oauth2Client.setCredentials({ refresh_token: decryptGoogleToken(orgData.google_refresh_token) });
          calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
          allEvents = await listAllActiveGoogleEvents(calendarApi, orgData.google_calendar_id);
      } catch (e) {
          const se = classifyGoogleError(e);
          return {
              processed: 0,
              succeeded: 0,
              failed: 0,
              connected: true,
              errorKind: se.kind,
              failedIds: [] as string[],
              ...emptyGoogleSyncStats(),
          };
      }
      const eventsByShiftId = new Map<string, calendar_v3.Schema$Event[]>();
      const legacyEventsBySignature = new Map<string, calendar_v3.Schema$Event[]>();
      for (const event of allEvents) {
          const eventOrgId = getGoogleEventPrivateProp(event, GOOGLE_PROP_ORG_ID);
          const eventShiftId = getGoogleEventPrivateProp(event, GOOGLE_PROP_SHIFT_ID);
          if (eventOrgId === organizationId && eventShiftId) {
              eventsByShiftId.set(eventShiftId, [...(eventsByShiftId.get(eventShiftId) || []), event]);
          } else if (!eventShiftId) {
              const signature = getLegacyEventSignature(event);
              legacyEventsBySignature.set(signature, [...(legacyEventsBySignature.get(signature) || []), event]);
          }
      }

      const { data: shifts } = await supabaseAdmin
          .from('shifts')
          .select('id, title, start_at, end_at, status, cancel_reason, google_event_id, deleted_at, google_sync_status, shift_staffs(staff_id)')
          .eq('organization_id', organizationId)
          .order('id', { ascending: true })
          .limit(limit);

      const stats = emptyGoogleSyncStats();
      let processed = 0;
      let succeeded = 0;
      const failedIds: string[] = [];
      let errorKind: SyncErrorKind | undefined;

      for (const shift of (shifts || []) as ShiftForGoogle[]) {
          processed++;
          try {
              if (shift.deleted_at) {
                  const candidates = [...(eventsByShiftId.get(shift.id) || [])];
                  if (shift.google_event_id) {
                      const savedEvent = allEvents.find(event => event.id === shift.google_event_id);
                      if (savedEvent && !candidates.some(event => event.id === savedEvent.id)) candidates.push(savedEvent);
                  }
                  for (const event of candidates) {
                      if (!event.id) continue;
                      const deleted = await deleteGoogleEventIfExists(calendarApi, orgData.google_calendar_id, event.id);
                      if (deleted) stats.deletedRemote++;
                  }
                  await markShiftGoogleSync(shift.id, 'synced', { eventId: null });
                  succeeded++;
                  continue;
              }

              const eventBody = buildGoogleEventBody(organizationId, shift);
              const signature = getEventBodySignature(eventBody);
              const candidates = [...(eventsByShiftId.get(shift.id) || [])];

              if (shift.google_event_id) {
                  const savedEvent = allEvents.find(event => event.id === shift.google_event_id);
                  if (savedEvent && !candidates.some(event => event.id === savedEvent.id)) candidates.push(savedEvent);
              }

              if (candidates.length === 0) {
                  const legacyCandidates = legacyEventsBySignature.get(signature) || [];
                  candidates.push(...legacyCandidates);
              }

              const primary = choosePrimaryGoogleEvent(candidates, shift.google_event_id);
              if (primary?.id) {
                  await withRetry(() => calendarApi.events.update({
                      calendarId: orgData.google_calendar_id!,
                      eventId: primary.id!,
                      requestBody: eventBody,
                  }));
                  stats.updated++;
                  if (primary.id !== shift.google_event_id) stats.linked++;
                  const deduped = await deleteDuplicateGoogleEvents(calendarApi, orgData.google_calendar_id, candidates, primary.id);
                  stats.deduped += deduped;
                  await markShiftGoogleSync(shift.id, 'synced', { eventId: primary.id });
              } else {
                  const res = await withRetry(() => calendarApi.events.insert({
                      calendarId: orgData.google_calendar_id!,
                      requestBody: eventBody,
                  }));
                  if (res.data.id) await markShiftGoogleSync(shift.id, 'synced', { eventId: res.data.id });
                  stats.created++;
              }
              succeeded++;
          } catch (e) {
              const se = classifyGoogleError(e);
              await markShiftGoogleSync(shift.id, 'failed', { error: se.message }).catch((error) => logExternalError('google.sync.mark-failed', error));
              failedIds.push(shift.id);
              errorKind = se.kind;
              if (se.kind === 'auth') break;
          }
      }

      await recordAuditEvent({
          organizationId, actorId: actor.userId, action: 'integration.calendar.sync', resourceType: 'organization', resourceId: organizationId,
          details: { mode: 'repair', processed, succeeded, failed: failedIds.length },
      });
      return {
          processed,
          succeeded,
          failed: failedIds.length,
          failedIds,
          connected: true,
          errorKind,
          ...stats,
      };
  });
}

export async function syncSingleShift(organizationId: string, shiftId: string, action: 'sync' | 'delete' = 'sync') {
  return withSafeError('syncSingleShift', async () => {
      const actor = await assertShiftPermission(organizationId, action === 'delete' ? 'delete' : 'edit', { shiftId });
      try {
          await syncToGoogleCalendarDirect(organizationId, shiftId, action);
          await recordAuditEvent({
              organizationId, actorId: actor.userId, action: 'integration.calendar.sync', resourceType: 'shift', resourceId: shiftId,
              details: { mode: action === 'delete' ? 'single_delete' : 'single_sync', processed: 1, succeeded: 1, failed: 0 },
          });
          return { success: true };
      } catch (error) {
          throw sanitizeExternalError(error, 'google.sync.single');
      }
  });
}
