import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), attempt: vi.fn(), limited: vi.fn() }));
vi.mock('./auth', () => ({ getAuthedUser: async () => ({ id: 'user', email: 'user@example.com', sessionId: 'browser-session' }) }));
vi.mock('./serviceRole', () => ({ serviceRoleForServerSessions: () => ({ from: mocks.from }) }));
vi.mock('./loginAttempts', () => ({ isLoginRateLimited: mocks.limited, recordLoginAttempt: mocks.attempt }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } }) }));
import { consumeReauthGrant, issueReauthGrant } from './reauth';
beforeEach(() => { vi.resetAllMocks(); mocks.limited.mockResolvedValue(false); mocks.signOut.mockResolvedValue({ error: null }); });
describe('password reauth and existing grant guarantees', () => {
  it('logs out only its temporary verifier session, retaining the browser session', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: 'user' }, session: {} }, error: null });
    mocks.from.mockReturnValue({ insert: async () => ({ error: null }) });
    await issueReauthGrant('account_email_change', 'password');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('records a wrong password and issues no proof', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'invalid_credentials' } });
    await expect(issueReauthGrant('account_delete', 'wrong')).rejects.toThrow('失敗');
    expect(mocks.attempt).toHaveBeenCalledWith('user@example.com', 'failure'); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rate-limits password verification without sending more Auth requests', async () => {
    mocks.limited.mockResolvedValue(true);
    await expect(issueReauthGrant('account_delete', 'password')).rejects.toThrow('試行回数');
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('rejects forged/reused/expired grants while matching user, session and purpose atomically', async () => {
    const query = { update: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query), gt: vi.fn(() => query),
      select: vi.fn(() => query), maybeSingle: async () => ({ data: null, error: null }) };
    mocks.from.mockReturnValue(query);
    await expect(consumeReauthGrant('account_password_change', 'expired')).rejects.toThrow('無効');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user');
    expect(query.eq).toHaveBeenCalledWith('auth_session_id', 'browser-session');
    expect(query.eq).toHaveBeenCalledWith('purpose', 'account_password_change');
    expect(query.is).toHaveBeenCalledWith('used_at', null);
    expect(query.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
  });
});
