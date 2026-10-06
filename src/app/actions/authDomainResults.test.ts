import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ limited: vi.fn(), delay: vi.fn(), attempt: vi.fn(), register: vi.fn(), login: vi.fn(), session: vi.fn(), log: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ createSessionClient: async () => ({ auth: { signUp: mocks.register, signInWithPassword: mocks.login } }), registerSessionActivity: mocks.session }));
vi.mock('@/utils/supabase/loginAttempts', () => ({ isLoginRateLimited: mocks.limited, applyProgressiveLoginDelay: mocks.delay, recordLoginAttempt: mocks.attempt }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/utils/supabase/reauth', () => ({}));
vi.mock('@/utils/supabase/stepupReauth', () => ({}));
vi.mock('@/utils/log', () => ({ logError: mocks.log }));
import { loginWithPassword, registerWithPassword } from './auth';
beforeEach(() => { vi.resetAllMocks(); mocks.limited.mockResolvedValue(false); });
describe('existing Auth domain result boundaries', () => {
  it.each([['invalid_credentials', 'invalid_credentials'], ['email_not_confirmed', 'email_unconfirmed']])('uses Auth code %s independent of message', async (code, reason) => {
    mocks.login.mockResolvedValue({ data: { user: null }, error: { code, message: 'different localized wording' } });
    await expect(loginWithPassword('user@example.com', 'password')).resolves.toEqual({ ok: false, reason });
  });
  it('does not classify internal text as a credentials error', async () => {
    mocks.login.mockResolvedValue({ data: { user: null }, error: { code: 'unexpected_failure', message: 'Invalid login credentials in private stack' } });
    await expect(loginWithPassword('user@example.com', 'password')).resolves.toEqual({ ok: false, reason: 'error' });
  });
  it.each(['user_already_exists', 'email_exists'])('uses the registration code %s', async code => {
    mocks.register.mockResolvedValue({ data: { user: null }, error: { code } });
    await expect(registerWithPassword('user@example.com', 'password')).resolves.toEqual({ ok: false, reason: 'already_registered' });
  });
  it.each(['login', 'register'])('returns fixed domain failure when %s infrastructure throws', async action => {
    mocks.limited.mockRejectedValue(new Error('private connection details'));
    const operation = action === 'login' ? loginWithPassword : registerWithPassword;
    await expect(operation('user@example.com', 'password')).resolves.toEqual({ ok: false, reason: 'error' });
    expect(mocks.log).toHaveBeenCalled();
  });
  it('does not report login success when application session registration fails', async () => {
    mocks.login.mockResolvedValue({ data: { user: { id: 'user' }, session: {} }, error: null });
    mocks.session.mockRejectedValue(new Error('session DB unavailable'));
    await expect(loginWithPassword('user@example.com', 'password')).resolves.toEqual({ ok: false, reason: 'error' });
  });
});
