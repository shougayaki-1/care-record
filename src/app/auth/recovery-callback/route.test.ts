import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), register: vi.fn(), issue: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { verifyOtp: mocks.verify } }) }));
vi.mock('@/utils/supabase/auth', () => ({ registerSessionActivity: mocks.register }));
vi.mock('@/utils/supabase/reauth', () => ({ issueGrantToken: mocks.issue }));
import { GET } from './route';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ data: { session: { user: { id: 'recovery-user' } } }, error: null });
  mocks.register.mockResolvedValue('recovery-session'); mocks.issue.mockResolvedValue({ token: 'proof' });
});

describe('dedicated password recovery callback', () => {
  it('verifies only recovery tokens, binds a short httpOnly proof, strips credentials and ignores next', async () => {
    const response = await GET(new NextRequest('https://care.example/auth/recovery-callback?token_hash=secret&type=recovery&next=https://evil.example'));
    expect(mocks.verify).toHaveBeenCalledWith({ token_hash: 'secret', type: 'recovery' });
    expect(mocks.issue).toHaveBeenCalledWith('account_password_reset', 'recovery-user', 'recovery-session');
    expect(response.headers.get('location')).toBe('/auth/reset-password');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.cookies.get('cr_password_recovery')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/auth' });
  });
  it.each(['?code=normal-login-code', '?token_hash=secret&type=signup', '?type=recovery', ''])('rejects %s without issuing proof', async query => {
    const response = await GET(new NextRequest(`https://care.example/auth/recovery-callback${query}`));
    expect(response.headers.get('location')).toBe('/auth/reset-password?error=invalid_link');
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('expired, replayed, or invalid tokens never issue a reset proof', async () => {
    mocks.verify.mockResolvedValue({ data: { session: null }, error: { message: 'secret must not escape' } });
    const response = await GET(new NextRequest('https://care.example/auth/recovery-callback?token_hash=expired&type=recovery'));
    expect(response.headers.get('location')).not.toContain('expired');
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.issue).not.toHaveBeenCalled();
  });
});
