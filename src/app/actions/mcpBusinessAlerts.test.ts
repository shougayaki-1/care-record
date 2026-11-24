import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.auth, createSessionClient: async () => ({ rpc: mocks.rpc }) }));
import { getBusinessAlertPreferences, setBusinessAlertPreferences } from './mcpBusinessAlerts';
const id = '10000000-0000-4000-8000-000000000001';
const settings = { enabled: true, frequency: 'daily' as const, pending_reports: true, unassigned_shifts: false };
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id }); });
it('refuses invalid or empty enabled preferences before accessing the database', async () => {
  expect((await setBusinessAlertPreferences(id, { ...settings, pending_reports: false })).ok).toBe(false);
  expect((await getBusinessAlertPreferences('bad')).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('does not expose details when notification permission is denied', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: '42501', message: 'private detail' }, data: null });
  const result = await setBusinessAlertPreferences(id, settings);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private detail');
});
