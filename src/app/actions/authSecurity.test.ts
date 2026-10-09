import { readActionResult } from '@/utils/actionResult';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(), reserve: vi.fn(), getAuthedUser: vi.fn(),
  getUser: vi.fn(), rpc: vi.fn(), updateUser: vi.fn(), reset: vi.fn(), consume: vi.fn(),
  verifyPassword: vi.fn(), begin: vi.fn(),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://care.example' }),
  cookies: async () => ({ get: (key: string) => mocks.cookies.has(key) ? { value: mocks.cookies.get(key) } : undefined,
    set: (key: string, value: string, options?: { maxAge?: number }) => options?.maxAge === 0 ? mocks.cookies.delete(key) : mocks.cookies.set(key, value), delete: (key: string) => mocks.cookies.delete(key) }),
}));
vi.mock('@/utils/supabase/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/supabase/auth')>()),
  getAuthedUser: mocks.getAuthedUser,
  createSessionClient: async () => ({ auth: { getUser: mocks.getUser, updateUser: mocks.updateUser, resetPasswordForEmail: mocks.reset }, rpc: mocks.rpc }),
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/utils/supabase/accountSecurity', () => ({ prepareAccountSecurityChange: async () => ({ id: 'user', sessionId: 'session' }) }));
vi.mock('@/utils/supabase/passwordResetLimit', () => ({ reservePasswordReset: mocks.reserve }));
vi.mock('@/utils/supabase/reauth', () => ({ consumeReauthGrant: mocks.consume, issueReauthGrant: mocks.verifyPassword }));
vi.mock('@/utils/supabase/stepupReauth', () => ({ beginStepUpReauth: mocks.begin }));
import { changeAccountEmail, changeAccountPassword, finishPasswordReset, getReauthMethods, requestPasswordReset, startProviderReauth } from './authSecurity';

beforeEach(() => {
  vi.resetAllMocks(); mocks.cookies.clear();
  mocks.getAuthedUser.mockResolvedValue({ id: 'user', sessionId: 'session' });
  mocks.reserve.mockResolvedValue(true); mocks.reset.mockResolvedValue({ error: null });
  mocks.consume.mockResolvedValue({ userId: 'user' }); mocks.updateUser.mockResolvedValue({ error: null });
});

describe('password recovery request', () => {
  it.each([null, { code: 'user_not_found' }, { code: 'over_email_send_rate_limit' }])('account-independent result for Auth result %j', async error => {
    mocks.reset.mockResolvedValue({ error });
    expect(await readActionResult(requestPasswordReset('Person@Example.com'))).toEqual({ ok: true });
    expect(mocks.reset).toHaveBeenCalledWith('person@example.com', { redirectTo: 'https://care.example/auth/recovery-callback' });
  });
  it('a rate-limited request gives the same completion and does not send mail', async () => {
    mocks.reserve.mockResolvedValue(false);
    expect(await readActionResult(requestPasswordReset('person@example.com'))).toEqual({ ok: true });
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it('invalid email never reaches Auth', async () => {
    expect(await readActionResult(requestPasswordReset('bad'))).toEqual({ ok: false });
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});

describe('available identity methods', () => {
  it.each([
    [true, [], ['password']], [false, ['google'], ['google']],
    [false, ['azure'], ['azure']], [true, ['google', 'azure'], ['password', 'google', 'azure']],
  ])('password %s identities %j', async (hasPassword, providers, expected) => {
    mocks.getUser.mockResolvedValue({ data: { user: { identities: providers.map(provider => ({ provider })) } }, error: null });
    mocks.rpc.mockResolvedValue({ data: hasPassword, error: null });
    expect(await readActionResult(getReauthMethods())).toEqual(expected);
  });
  it('passes the explicitly selected provider and clears a previous grant', async () => {
    mocks.cookies.set('su_grant', 'old-token'); mocks.begin.mockResolvedValue({ nonce: 'nonce', provider: 'azure' });
    await readActionResult(startProviderReauth('account_delete', 'azure'));
    expect(mocks.begin).toHaveBeenCalledWith('account_delete', 'azure');
    expect(mocks.cookies.has('su_grant')).toBe(false);
  });
});

describe('sensitive account actions', () => {
  it.each(['account_password_change', 'account_email_change', 'account_password_reset'])('rejects missing/expired/wrong-session %s proof before changing Auth', async purpose => {
    mocks.consume.mockRejectedValue(new Error('invalid proof'));
    const operation = purpose === 'account_password_change' ? readActionResult(changeAccountPassword('new-password', 'new-password', 'expired'))
      : purpose === 'account_email_change' ? readActionResult(changeAccountEmail('new@example.com', 'expired')) : readActionResult(finishPasswordReset('new-password', 'new-password'));
    await expect(operation).rejects.toThrow('処理に失敗しました');
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('reset requires its dedicated cookie and removes it before mutation/replay', async () => {
    mocks.cookies.set('cr_password_recovery', 'recovery-proof');
    await readActionResult(finishPasswordReset('new-password', 'new-password'));
    expect(mocks.consume).toHaveBeenCalledWith('account_password_reset', 'recovery-proof');
    expect(mocks.cookies.has('cr_password_recovery')).toBe(false);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  });
  it('password mismatch/policy failure does not consume any proof', async () => {
    await expect(readActionResult(changeAccountPassword('short', 'short', 'grant'))).rejects.toThrow('8文字');
    await expect(readActionResult(finishPasswordReset('new-password', 'different'))).rejects.toThrow('一致');
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it('consumes the purpose-specific grant before an email change', async () => {
    await readActionResult(changeAccountEmail('new@example.com', 'email-proof'));
    expect(mocks.consume).toHaveBeenCalledWith('account_email_change', 'email-proof');
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUser.mock.invocationCallOrder[0]);
  });
});

describe('classified Auth and reauth outcomes', () => {
  it('returns a reauth code without mutating Auth when proof is expired', async () => {
    const { ExpectedActionError } = await import('@/utils/errors');
    mocks.consume.mockRejectedValue(new ExpectedActionError('REAUTH_REQUIRED', 'もう一度再認証してください'));
    await expect(changeAccountEmail('new@example.com', 'spent')).resolves.toEqual({ ok: false, error: { code: 'REAUTH_REQUIRED', message: 'もう一度再認証してください' } });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('does not treat a password-method RPC outage as unavailable identity methods', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { identities: [] } }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private password RPC 権限' } });
    const result = await getReauthMethods();
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private password RPC');
  });
  it.each([[null, 'UNAUTHENTICATED'], [{ status: 503, message: 'private Auth details' }, 'UNEXPECTED_ERROR']])('distinguishes missing user from Auth failure %j', async (error, code) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(getReauthMethods()).resolves.toMatchObject({ ok: false, error: { code } });
  });
  it('returns a generic failure for an Auth update outage instead of validation error', async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error('private Auth details') });
    await expect(changeAccountPassword('new-password', 'new-password', 'proof')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  });
});
