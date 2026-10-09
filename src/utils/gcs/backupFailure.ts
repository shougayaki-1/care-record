import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { createNotification } from '@/utils/supabase/notifications';
import { logError } from '@/utils/log';

/** A scheduled daily/monthly occurrence keeps the same UUID across retries. */
export async function notifyAutomaticBackupFailure(
  client: SupabaseClient<Database>,
  kind: 'daily' | 'monthly',
  period: string,
  organizationId: string | null,
): Promise<void> {
  try {
    if (!(kind === 'daily' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(period)) {
      throw new Error('invalid_backup_period');
    }
    const hash = createHash('sha256').update(`backup.failed:${kind}:${period}`).digest('hex');
    const dedupeKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const { data, error } = await client.rpc('get_backup_notification_recipients', {
      p_org_id: organizationId ?? undefined,
    });
    if (error) throw new Error('notification_recipients_failed');
    for (const recipient of data ?? []) {
      // Isolate a failed recipient from the other deliveries and the backup.
      try {
        await createNotification(client, {
          userId: recipient.user_id, organizationId: recipient.organization_id,
          eventType: 'backup.failed', dedupeKey,
        }, 'best_effort');
      } catch {
        logError('notification_creation_failed', { eventType: 'backup.failed' });
      }
    }
  } catch {
    logError('notification_creation_failed', { eventType: 'backup.failed' });
  }
}
