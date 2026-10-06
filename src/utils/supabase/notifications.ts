import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/types/database.generated';
import { notificationEvents, type NotificationEventType } from '@/lib/notifications/model';
import { sanitizeDbError, ExpectedActionError } from '@/utils/errors';
import { logError } from '@/utils/log';

const notificationInput = z.strictObject({
  userId: z.uuid(),
  organizationId: z.uuid().nullable(),
  eventType: z.enum(Object.keys(notificationEvents) as [NotificationEventType, ...NotificationEventType[]]),
  resourceId: z.uuid().nullable().optional(),
  actorId: z.uuid().nullable().optional(),
  // An event occurrence UUID, never a name, filename, or free-form text.
  dedupeKey: z.uuid().nullable().optional(),
});
export type CreateNotificationInput = z.input<typeof notificationInput>;
export type NotificationCreationResult = { status: 'created'; id: string } | { status: 'duplicate' | 'failed' };

/**
 * Infrastructure backends pass their existing purpose-authorized client.
 * No service-role client is acquired here. Ordinary business mutations must
 * call private.create_notification inside their authorized atomic DB RPC.
 * The public creation RPC is deliberately unavailable to authenticated users.
 */
export async function createNotification(
  client: SupabaseClient<Database>,
  input: CreateNotificationInput,
  failureMode: 'required' | 'best_effort' = 'required',
): Promise<NotificationCreationResult> {
  const parsed = notificationInput.safeParse(input);
  if (!parsed.success) throw new ExpectedActionError('VALIDATION_ERROR', '通知の入力が不正です');
  const value = parsed.data;
  try {
    const { data, error } = await client.rpc('create_notification', {
      p_user_id: value.userId,
      p_organization_id: value.organizationId ?? undefined,
      p_event_type: value.eventType,
      p_resource_id: value.resourceId ?? undefined,
      p_actor_id: value.actorId ?? undefined,
      p_dedupe_key: value.dedupeKey ?? undefined,
    });
    // Do not log DB details or input; either can contain sensitive data.
    if (error) throw new Error('notification_creation_failed');
    return data ? { status: 'created', id: data } : { status: 'duplicate' };
  } catch {
    logError('notification_creation_failed', { eventType: value.eventType, failureMode });
    if (failureMode === 'required') throw sanitizeDbError(new Error('notification_creation_failed'), 'notification.create');
    return { status: 'failed' };
  }
}
