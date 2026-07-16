import 'server-only';

import { type calendar_v3, google } from 'googleapis';

import { getGoogleOAuthClient } from '@/utils/googleCalendar';
import {
  GOOGLE_PROP_ORG_ID,
  GOOGLE_PROP_SHIFT_ID,
  SyncError,
  buildGoogleEventBody,
  choosePrimaryGoogleEvent,
  classifyGoogleError,
  emptyGoogleSyncStats,
  isActiveGoogleEvent,
  mergeGoogleSyncStats,
  type GoogleSyncStats,
  type GoogleSyncStatus,
  type ShiftForGoogle,
  type SyncErrorKind,
} from '@/utils/googleSync';
import { decryptGoogleToken } from '@/utils/googleTokenCrypto';
import { createSessionClient } from '@/utils/supabase/auth';

export type GoogleCalendarClient = ReturnType<typeof google.calendar>;

export type BatchOutcome = {
  succeeded: number;
  failed: number;
  failedIds: string[];
  stats: GoogleSyncStats;
  errorKind?: SyncErrorKind;
};

export async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const syncError = classifyGoogleError(error);
      attempt += 1;
      if (
        attempt > retries
        || (syncError.kind !== 'rate_limit' && syncError.kind !== 'transient')
      ) throw syncError;
      const backoff = Math.min(8000, 400 * 2 ** (attempt - 1))
        + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

async function listGoogleEventsByShiftId(
  calendarApi: GoogleCalendarClient,
  calendarId: string,
  organizationId: string,
  shiftId: string,
): Promise<calendar_v3.Schema$Event[]> {
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const response = await withRetry(() => calendarApi.events.list({
      calendarId,
      maxResults: 2500,
      pageToken,
      showDeleted: false,
      privateExtendedProperty: [
        `${GOOGLE_PROP_SHIFT_ID}=${shiftId}`,
        `${GOOGLE_PROP_ORG_ID}=${organizationId}`,
      ],
    }));
    events.push(...(response.data.items || []).filter(isActiveGoogleEvent));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return events;
}

export async function listAllActiveGoogleEvents(
  calendarApi: GoogleCalendarClient,
  calendarId: string,
): Promise<calendar_v3.Schema$Event[]> {
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const response = await withRetry(() => calendarApi.events.list({
      calendarId,
      maxResults: 2500,
      pageToken,
      showDeleted: false,
    }));
    events.push(...(response.data.items || []).filter(isActiveGoogleEvent));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return events;
}

export async function deleteGoogleEventIfExists(
  calendarApi: GoogleCalendarClient,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  try {
    await withRetry(() => calendarApi.events.delete({ calendarId, eventId }));
    return true;
  } catch (error: unknown) {
    const syncError = classifyGoogleError(error);
    if (syncError.code === 404 || syncError.code === 410) return false;
    throw syncError;
  }
}

export async function deleteDuplicateGoogleEvents(
  calendarApi: GoogleCalendarClient,
  calendarId: string,
  events: calendar_v3.Schema$Event[],
  keepEventId: string,
): Promise<number> {
  let deduped = 0;
  for (const event of events) {
    if (!event.id || event.id === keepEventId || event.status === 'cancelled') continue;
    await deleteGoogleEventIfExists(calendarApi, calendarId, event.id);
    deduped += 1;
  }
  return deduped;
}

export async function markShiftGoogleSync(
  shiftId: string,
  status: GoogleSyncStatus,
  options: { eventId?: string | null; error?: string | null } = {},
) {
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('mark_shift_google_sync', {
    p_shift_id: shiftId,
    p_status: status,
    p_event_id: 'eventId' in options ? options.eventId ?? null : null,
    p_set_event_id: 'eventId' in options,
    p_error: options.error ?? null,
  });
  if (error) throw error;
}

export async function syncToGoogleCalendarDirect(
  organizationId: string,
  shiftId: string,
  action: 'sync' | 'delete',
): Promise<GoogleSyncStats> {
  const stats = emptyGoogleSyncStats();
  const supabase = await createSessionClient();
  const { data: context, error: contextError } = await supabase.rpc('get_google_sync_target', {
    p_org_id: organizationId, p_shift_id: shiftId,
  });
  if (contextError) throw contextError;
  const syncContext = context as unknown as {
    organization: { google_calendar_id: string | null; google_refresh_token: string | null };
    shift: ShiftForGoogle | null;
  } | null;
  const orgData = syncContext?.organization;
  if (!orgData?.google_calendar_id || !orgData?.google_refresh_token) {
    throw new SyncError('Google calendar not connected', 'skipped');
  }

  const shiftData = syncContext?.shift;
  if (!shiftData) throw new SyncError('Shift not found', 'skipped');

  const oauth2Client = getGoogleOAuthClient();
  oauth2Client.setCredentials({ refresh_token: decryptGoogleToken(orgData.google_refresh_token) });
  const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

  if (action === 'delete' || shiftData.deleted_at) {
    if (shiftData.google_event_id) {
      const deleted = await deleteGoogleEventIfExists(
        calendarApi,
        orgData.google_calendar_id,
        shiftData.google_event_id,
      );
      if (deleted) stats.deletedRemote += 1;
    }
    const linkedEvents = await listGoogleEventsByShiftId(
      calendarApi,
      orgData.google_calendar_id,
      organizationId,
      shiftId,
    );
    for (const event of linkedEvents) {
      if (!event.id || event.id === shiftData.google_event_id) continue;
      const deleted = await deleteGoogleEventIfExists(
        calendarApi,
        orgData.google_calendar_id,
        event.id,
      );
      if (deleted) stats.deletedRemote += 1;
    }
    await markShiftGoogleSync(shiftId, 'synced', { eventId: null });
    return stats;
  }

  const eventBody = buildGoogleEventBody(organizationId, shiftData as ShiftForGoogle);
  let newEventId = shiftData.google_event_id || null;

  if (shiftData.google_event_id) {
    try {
      await withRetry(() => calendarApi.events.update({
        calendarId: orgData.google_calendar_id!,
        eventId: shiftData.google_event_id!,
        requestBody: eventBody,
      }));
      stats.updated += 1;
      const linkedEvents = await listGoogleEventsByShiftId(
        calendarApi,
        orgData.google_calendar_id,
        organizationId,
        shiftId,
      );
      stats.deduped += await deleteDuplicateGoogleEvents(
        calendarApi,
        orgData.google_calendar_id,
        linkedEvents,
        shiftData.google_event_id,
      );
    } catch (error: unknown) {
      const syncError = classifyGoogleError(error);
      if (syncError.code === 404) newEventId = null;
      else throw syncError;
    }
  }

  if (!newEventId) {
    const linkedEvents = await listGoogleEventsByShiftId(
      calendarApi,
      orgData.google_calendar_id,
      organizationId,
      shiftId,
    );
    const primary = choosePrimaryGoogleEvent(linkedEvents, shiftData.google_event_id);
    if (primary?.id) {
      await withRetry(() => calendarApi.events.update({
        calendarId: orgData.google_calendar_id!,
        eventId: primary.id!,
        requestBody: eventBody,
      }));
      newEventId = primary.id;
      stats.linked += 1;
      stats.updated += 1;
      stats.deduped += await deleteDuplicateGoogleEvents(
        calendarApi,
        orgData.google_calendar_id,
        linkedEvents,
        primary.id,
      );
    }
  }

  if (!newEventId) {
    const response = await withRetry(() => calendarApi.events.insert({
      calendarId: orgData.google_calendar_id!,
      requestBody: eventBody,
    }));
    if (response.data.id) newEventId = response.data.id;
    stats.created += 1;
  }

  await markShiftGoogleSync(shiftId, 'synced', { eventId: newEventId });
  return stats;
}

export async function trySyncSilently(
  organizationId: string,
  shiftId: string,
  action: 'sync' | 'delete',
) {
  try {
    await syncToGoogleCalendarDirect(organizationId, shiftId, action);
  } catch (error) {
    const syncError = classifyGoogleError(error);
    if (syncError.kind !== 'skipped') {
      await markShiftGoogleSync(shiftId, 'failed', { error: syncError.message })
        .catch(console.error);
      console.error(
        `Google Calendar sync (${action}) failed for shift ${shiftId} [${syncError.kind}]:`,
        syncError.message,
      );
    }
  }
}

export async function processShiftsSequential(
  organizationId: string,
  shifts: Array<{ id: string }>,
  action: 'sync' | 'delete',
  delayMs = 150,
): Promise<BatchOutcome> {
  let succeeded = 0;
  const failedIds: string[] = [];
  const stats = emptyGoogleSyncStats();
  let errorKind: SyncErrorKind | undefined;

  for (const shift of shifts) {
    try {
      const result = await syncToGoogleCalendarDirect(organizationId, shift.id, action);
      mergeGoogleSyncStats(stats, result);
      succeeded += 1;
    } catch (error) {
      const syncError = classifyGoogleError(error);
      if (syncError.kind === 'skipped') {
        succeeded += 1;
        continue;
      }
      await markShiftGoogleSync(shift.id, 'failed', { error: syncError.message })
        .catch(console.error);
      failedIds.push(shift.id);
      errorKind = syncError.kind;
      if (syncError.kind === 'auth') break;
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { succeeded, failed: failedIds.length, failedIds, stats, errorKind };
}
