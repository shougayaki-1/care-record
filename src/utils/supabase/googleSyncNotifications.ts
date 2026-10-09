import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { logError } from '@/utils/log';

/** The DB authorizes the actor and derives recipients; no raw error input. */
export async function markGoogleCalendarSyncResult(client: SupabaseClient<Database>, organizationId: string, failed: boolean) {
  try {
    const { error } = await client.rpc('mark_google_calendar_sync_result', { p_org_id: organizationId, p_failed: failed });
    if (error) throw new Error('notification_creation_failed');
  } catch {
    logError('notification_creation_failed', { eventType: 'google_calendar.sync_failed' });
  }
}
