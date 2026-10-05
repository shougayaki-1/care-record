import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database.generated';
import { createNotification, type CreateNotificationInput } from './notifications';

vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: (error: Error) => ({ message: error.message }) }));
import { logError } from '@/utils/log';

const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient<Database>;
const input: CreateNotificationInput = {
  userId: '00000000-0000-4000-8000-000000000001', organizationId: null,
  eventType: 'backup.failed', dedupeKey: '00000000-0000-4000-8000-000000000002',
};

beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: 'notification-id', error: null }); });
describe('backend notification creation', () => {
  it('passes identifiers to the bounded RPC without caller-provided text', async () => {
    expect(await createNotification(client, input)).toEqual({ status: 'created', id: 'notification-id' });
    expect(rpc).toHaveBeenCalledWith('create_notification', {
      p_user_id: input.userId, p_organization_id: undefined, p_event_type: input.eventType,
      p_resource_id: undefined, p_actor_id: undefined, p_dedupe_key: input.dedupeKey,
    });
  });
  it('treats an atomic dedupe conflict as duplicate without updating an existing row', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await createNotification(client, input)).toEqual({ status: 'duplicate' });
    expect(logError).not.toHaveBeenCalled();
  });
  it.each(['title', 'content', 'linkUrl', 'resourceType', 'priority'])('rejects caller-supplied %s before any DB call', async field => {
    await expect(createNotification(client, { ...input, [field]: 'sensitive fixture text' })).rejects.toThrow('通知の入力が不正です');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects unregistered success events and free-form dedupe keys', async () => {
    await expect(createNotification(client, { ...input, eventType: 'report.saved' } as unknown as CreateNotificationInput)).rejects.toThrow();
    await expect(createNotification(client, { ...input, dedupeKey: 'sensitive fixture text' })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('fails required creation safely without leaking DB details to logs', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sensitive fixture text' } });
    await expect(createNotification(client, input)).rejects.toThrow('処理に失敗しました');
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('sensitive fixture text');
  });
  it('returns and logs explicit best-effort failure for DB and transport errors', async () => {
    rpc.mockRejectedValue(new Error('sensitive fixture text'));
    expect(await createNotification(client, input, 'best_effort')).toEqual({ status: 'failed' });
    expect(logError).toHaveBeenCalledWith('notification_creation_failed', { eventType: 'backup.failed', failureMode: 'best_effort' });
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('sensitive fixture text');
  });
});
