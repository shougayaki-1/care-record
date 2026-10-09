import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { withActionResult } from '@/utils/errors';

const mocks = vi.hoisted(() => ({ from: vi.fn(), user: vi.fn(), session: vi.fn(), log: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: mocks.user, getSession: mocks.session } }) }));
vi.mock('@supabase/supabase-js', async importOriginal => ({
  ...await importOriginal<typeof import('@supabase/supabase-js')>(),
  createClient: () => ({ from: mocks.from, auth: { getUser: mocks.user } }),
}));
vi.mock('@/utils/log', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/log')>(), logError: mocks.log,
}));

let auth: typeof import('./auth');
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  auth = await import('./auth');
});
afterAll(() => vi.unstubAllEnvs());

function row(data: unknown, error: unknown = null) {
  const result = { data, error };
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), gte: vi.fn(), gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of [query.select, query.eq, query.is, query.gte, query.gt]) method.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  const payload = Buffer.from(JSON.stringify({ session_id: '85000000-0000-4000-8000-000000000001' })).toString('base64url');
  mocks.session.mockResolvedValue({ data: { session: { access_token: `synthetic.${payload}.signature` } }, error: null });
});

const load = () => withActionResult('membership', () => auth.assertOrgRole('org-1'));
describe('classified auth states preserve the authorization boundary', () => {
  it('returns unauthenticated for an absent session, without any data query', async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(load()).resolves.toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps Auth network failures distinct from an absent session', async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('synthetic failure', 503) });
    await expect(load()).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalled();
  });
  it.each([null, { data: null, error: { message: 'private session 権限 detail' } }])(
    'distinguishes a revoked or expired session from a session query failure: %s', async failure => {
      mocks.from.mockReturnValue(row(failure ? failure.data : null, failure?.error ?? null));
      await expect(load()).resolves.toMatchObject({ ok: false, error: {
        code: failure ? 'UNEXPECTED_ERROR' : 'SESSION_EXPIRED',
      } });
      expect(mocks.from).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { data: null, error: null, code: 'FORBIDDEN' },
    { data: null, error: { message: 'private membership 権限 detail' }, code: 'UNEXPECTED_ERROR' },
  ])('does not turn a membership DB error into an authorization state: $code', async ({ data, error, code }) => {
    mocks.from.mockReturnValueOnce(row({ session_hash: 'synthetic' })).mockReturnValueOnce(row(data, error));
    await expect(load()).resolves.toMatchObject({ ok: false, error: { code } });
  });
  it('retains the server-derived user and tenant filters for a permitted member', async () => {
    const session = row({ session_hash: 'synthetic' });
    const membership = row({ role: 'member' });
    mocks.from.mockReturnValueOnce(session).mockReturnValueOnce(membership);
    await expect(load()).resolves.toEqual({ ok: true, data: { userId: 'user-1', role: 'member' } });
    expect(membership.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['user_id', 'user-1']]);
    expect(session.is).toHaveBeenCalledWith('revoked_at', null);
    expect(session.gte).toHaveBeenCalledWith('last_activity', expect.any(String));
    expect(session.gt).toHaveBeenCalledWith('absolute_expires_at', expect.any(String));
  });
  it('rejects role link query failure instead of treating it as no assigned roles', async () => {
    mocks.from.mockReturnValueOnce(row({ role: 'member' }))
      .mockReturnValueOnce(row(null, { message: 'private role link detail' }));
    await expect(withActionResult('permissions', () => auth.getEffectivePermissions('org-1', 'user-1')))
      .resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(mocks.log).toHaveBeenCalled();
  });
});
