import { ExpectedActionError } from '@/utils/errors';
import { readActionResult } from '@/utils/actionResult';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  auth: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: state.auth, createSessionClient: async () => ({ from: state.from }) }));
vi.mock('@/utils/supabase/serviceRole', () => ({ serviceRoleForAuthManagement: () => ({}) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/utils/uploadSecurity', () => ({ sanitizeUploadedImage: vi.fn() }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: (error: Error) => ({ message: error.message }) }));
import { markNotificationRead } from './user';

const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.clearAllMocks();
  state.auth.mockResolvedValue({ id: 'receiver' });
  const query = { update: state.update, eq: state.eq, select: state.select, maybeSingle: state.maybeSingle };
  state.from.mockReturnValue(query); state.update.mockReturnValue(query); state.eq.mockReturnValue(query); state.select.mockReturnValue(query);
  state.maybeSingle.mockResolvedValue({ data: { read_at: '2026-10-04T00:00:00Z' }, error: null });
});
describe('markNotificationRead', () => {
  it('restricts the update to the authenticated receiver and returns DB read time', async () => {
    expect(await readActionResult(markNotificationRead(id))).toEqual({ success: true, readAt: '2026-10-04T00:00:00Z' });
    expect(state.eq.mock.calls).toEqual([['id', id], ['user_id', 'receiver']]);
    expect(state.update).toHaveBeenCalledWith({ is_read: true });
  });
  it('rejects invalid IDs and unauthenticated requests before mutation', async () => {
    await expect(readActionResult(markNotificationRead('invalid'))).rejects.toThrow('不正');
    state.auth.mockRejectedValue(new ExpectedActionError('UNAUTHENTICATED', '認証が必要です'));
    await expect(readActionResult(markNotificationRead(id))).rejects.toThrow('認証が必要です');
    expect(state.from).not.toHaveBeenCalled();
  });
  it('sanitizes DB failures', async () => {
    state.maybeSingle.mockResolvedValue({ data: null, error: { message: 'sensitive fixture text' } });
    await expect(readActionResult(markNotificationRead(id))).rejects.toThrow('処理に失敗しました');
  });
  it('does not report a successful read for an unavailable notification', async () => {
    state.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(readActionResult(markNotificationRead(id))).rejects.toThrow('通知が見つかりません');
  });
});
