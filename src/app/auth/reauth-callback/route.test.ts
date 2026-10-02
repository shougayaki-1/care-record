import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), register: vi.fn(), complete: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { exchangeCodeForSession: mocks.exchange } }) }));
vi.mock('@/utils/supabase/auth', () => ({ registerSessionActivity: mocks.register }));
vi.mock('@/utils/supabase/stepupReauth', () => ({ completeStepUpReauth: mocks.complete }));
vi.mock('@/utils/errors', () => ({ logExternalError: vi.fn() }));
import { GET } from './route';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
  mocks.register.mockResolvedValue('session'); mocks.complete.mockResolvedValue({ token: 'proof', purpose: 'account_delete' });
});
function request(query: string, nonce = 'nonce') {
  return new NextRequest(`http://127.0.0.1:3100/auth/reauth-callback${query}`, { headers: { cookie: `su_nonce=${nonce}; su_grant=stale` } });
}
describe('step-up callback', () => {
  it('returns to the allowed profile path on the same browser origin with httpOnly proof', async () => {
    const response = await GET(request('?code=code&nonce=nonce&next=%2Fapp%2Fprofile%3Fstepup%3D1'));
    expect(response.headers.get('location')).toBe('/app/profile?stepup=1');
    expect(mocks.complete).toHaveBeenCalledWith('nonce', 'user', 'session');
    expect(response.cookies.get('su_grant')).toMatchObject({ value: 'proof', httpOnly: true, maxAge: 60, secure: false });
  });
  it.each(['?error=access_denied&next=%2Fapp%2Fprofile', '?code=code&nonce=bad&next=%2Fapp%2Fprofile'])('OAuth cancellation or nonce mismatch %s deletes old proof and issues none', async query => {
    const response = await GET(request(query));
    expect(response.headers.get('location')).toBe('/app/profile?stepupError=1');
    expect(response.cookies.get('su_grant')?.value).toBe('');
    expect(response.cookies.get('su_grant')?.expires).toEqual(new Date(0));
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('an OAuth account mismatch never persists the exchanged session or proof', async () => {
    mocks.complete.mockRejectedValue(new Error('different account'));
    const response = await GET(request('?code=code&nonce=nonce&next=https%3A%2F%2Fevil.example'));
    expect(response.headers.get('location')).toBe('/app/settings?stepupError=1');
    expect(response.cookies.get('su_grant')?.value).toBe('');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
