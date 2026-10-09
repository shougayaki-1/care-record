import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAutomaticBackupFailure } from './backupFailure';

vi.mock('@/utils/supabase/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/utils/log', () => ({ logError: vi.fn() }));
import { createNotification } from '@/utils/supabase/notifications';
import { logError } from '@/utils/log';
const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient<Database>;
const recipients = [
  { user_id: '62000000-0000-4000-8000-000000000001', organization_id: '62000000-0000-4000-8000-000000000010' },
  { user_id: '62000000-0000-4000-8000-000000000002', organization_id: '62000000-0000-4000-8000-000000000010' },
];
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: recipients, error: null });
  vi.mocked(createNotification).mockResolvedValue({ status: 'created', id: 'notification' });
});

describe('automatic backup failure notifications', () => {
  it('selects recipients through the permission-bound DB function and uses the common helper', async () => {
    await notifyAutomaticBackupFailure(client, 'daily', '2026-10-06', recipients[0].organization_id);
    expect(rpc).toHaveBeenCalledWith('get_backup_notification_recipients', { p_org_id: recipients[0].organization_id });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(client, {
      userId: recipients[0].user_id, organizationId: recipients[0].organization_id,
      eventType: 'backup.failed', dedupeKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/),
    }, 'best_effort');
  });
  it('keeps a stable occurrence across retries and changes it for another day or job', async () => {
    for (let i = 0; i < 10; i++) await notifyAutomaticBackupFailure(client, 'daily', '2026-10-06', recipients[0].organization_id);
    const keys = vi.mocked(createNotification).mock.calls.map(call => call[1].dedupeKey);
    expect(new Set(keys).size).toBe(1);
    await notifyAutomaticBackupFailure(client, 'daily', '2026-10-07', null);
    await notifyAutomaticBackupFailure(client, 'monthly', '2026-10', null);
    expect(new Set(vi.mocked(createNotification).mock.calls.map(call => call[1].dedupeKey)).size).toBe(3);
    expect(rpc).toHaveBeenLastCalledWith('get_backup_notification_recipients', { p_org_id: undefined });
  });
  it('continues delivery when one recipient fails without exposing details', async () => {
    vi.mocked(createNotification).mockRejectedValueOnce(new Error('PHI token bucket private-path'));
    await expect(notifyAutomaticBackupFailure(client, 'daily', '2026-10-06', null)).resolves.toBeUndefined();
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith('notification_creation_failed', { eventType: 'backup.failed' });
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('PHI');
  });
  it.each(['db', 'transport'])('preserves the backup outcome on %s recipient selection failure', async mode => {
    if (mode === 'db') rpc.mockResolvedValue({ data: null, error: { message: 'credential' } });
    else rpc.mockRejectedValue(new Error('credential'));
    await expect(notifyAutomaticBackupFailure(client, 'daily', '2026-10-06', null)).resolves.toBeUndefined();
    expect(createNotification).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('credential');
  });
  it('has no notifications for an empty authorized recipient set', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await notifyAutomaticBackupFailure(client, 'daily', '2026-10-06', null);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
