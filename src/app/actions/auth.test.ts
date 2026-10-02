import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), audit: vi.fn(), revoke: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user, revokeCurrentSession: mocks.revoke }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/supabase/loginAttempts', () => ({}));
vi.mock('@/utils/supabase/reauth', () => ({}));
vi.mock('@/utils/supabase/stepupReauth', () => ({}));

import { recordLogout } from './auth';

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: 'user', sessionId: 'session' });
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.revoke.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('logout bookkeeping', () => {
  it('ログアウトの監査記録とセッション失効を実行する', async () => {
    await recordLogout();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.logout', actorId: 'user', sessionId: 'session',
    }));
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it('監査基盤の障害でもサーバーセッションの失効を続行する', async () => {
    mocks.audit.mockRejectedValue(new Error('audit offline'));
    await expect(recordLogout()).resolves.toBeUndefined();
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it('認証できない場合は復旧を例外で停止させない', async () => {
    mocks.user.mockRejectedValue(new Error('expired session'));
    await expect(recordLogout()).resolves.toBeUndefined();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('セッション失効に失敗しても復旧を例外で停止させない', async () => {
    mocks.revoke.mockRejectedValue(new Error('database offline'));
    await expect(recordLogout()).resolves.toBeUndefined();
  });
});
