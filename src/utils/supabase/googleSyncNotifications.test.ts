import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { describe, expect, it, vi } from 'vitest';
import { markGoogleCalendarSyncResult } from './googleSyncNotifications';
vi.mock('@/utils/log', () => ({ logError: vi.fn() }));
import { logError } from '@/utils/log';
describe('calendar listing failure notifications', () => {
  it('passes only organization and result to the authorized DB boundary', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await markGoogleCalendarSyncResult(client, 'org', true);
    await markGoogleCalendarSyncResult(client, 'org', false);
    expect(rpc.mock.calls).toEqual([
      ['mark_google_calendar_sync_result', { p_org_id: 'org', p_failed: true }],
      ['mark_google_calendar_sync_result', { p_org_id: 'org', p_failed: false }],
    ]);
  });
  it('does not replace an external failure with a notification error or log raw details', async () => {
    const client = { rpc: vi.fn().mockRejectedValue(new Error('PHI credential')) } as unknown as SupabaseClient<Database>;
    await expect(markGoogleCalendarSyncResult(client, 'org', true)).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('notification_creation_failed', { eventType: 'google_calendar.sync_failed' });
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('PHI');
  });
});
