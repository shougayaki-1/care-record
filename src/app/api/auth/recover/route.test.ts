import { runInNewContext } from 'node:vm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordLogout: vi.fn(), signOut: vi.fn() }));
vi.mock('@/app/actions/auth', () => ({ recordLogout: mocks.recordLogout }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { signOut: mocks.signOut } }) }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://care.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  mocks.recordLogout.mockReset().mockResolvedValue(undefined);
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const request = (origin: string | null = 'https://app.example') => new NextRequest('https://app.example/api/auth/recover', {
  method: 'POST',
  headers: {
    ...(origin ? { origin } : {}),
    cookie: 'sb-care-auth-token.0=stale; sb-care-auth-token.1=stale; sb-care-auth-token-code-verifier=pkce; su_nonce=nonce; su_grant=grant; other-app=keep; sb-other-auth-token=keep',
  },
});

describe('independent recovery route', () => {
  it('GET は HTML フォームのみ表示し、ログアウトや Cookie 書き換えを行わない', async () => {
    const response = GET();
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const html = await response.text();
    expect(html).toContain('method="post"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('/_next/');
    expect(mocks.recordLogout).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each(['audit', 'signout-returned', 'signout-thrown', 'config'])('%s 失敗でも全認証チャンクを失効し、他の Cookie を保持する', async failure => {
    if (failure === 'audit') mocks.recordLogout.mockRejectedValue(new Error('unavailable'));
    if (failure === 'signout-returned') mocks.signOut.mockResolvedValue({ error: new Error('offline') });
    if (failure === 'signout-thrown') mocks.signOut.mockRejectedValue(new Error('offline'));
    if (failure === 'config') vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const response = await POST(request());
    expect(response.status).toBe(200);
    for (const name of ['sb-care-auth-token.0', 'sb-care-auth-token.1', 'sb-care-auth-token-code-verifier', 'su_nonce', 'su_grant']) {
      expect(response.cookies.get(name)?.maxAge).toBe(0);
    }
    expect(response.cookies.get('other-app')).toBeUndefined();
    expect(response.cookies.get('sb-other-auth-token')).toBeUndefined();
    expect(await response.text()).toContain("window.location.replace('/')");
    if (failure !== 'config') expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('監査・Auth サーバーがハングしても有限時間で Cookie 削除へ進む', async () => {
    vi.useFakeTimers();
    mocks.recordLogout.mockReturnValue(new Promise(() => {}));
    mocks.signOut.mockReturnValue(new Promise(() => {}));
    const responsePromise = POST(request());
    await vi.advanceTimersByTimeAsync(4000);
    expect((await responsePromise).cookies.get('sb-care-auth-token.0')?.maxAge).toBe(0);
  });

  it.each([null, 'https://evil.example'])('Origin %s の POST を拒否してセッションを変えない', async origin => {
    const response = await POST(request(origin));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.recordLogout).not.toHaveBeenCalled();
  });

  it('React なしの完了 HTML がクライアント状態・SW キャッシュを消して hard navigation する', async () => {
    const response = await POST(request());
    const html = await response.text();
    const script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/)!;
    expect(response.headers.get('content-security-policy')).toContain(`'nonce-${script[1]}'`);
    const values = new Map([
      ['care-record-sidebar-open', 'false'], ['sb-care-auth-token-user', 'previous-user'],
      ['sb-care-auth-token.0', 'stale'], ['sb-care-auth-token-code-verifier', 'pkce'],
      ['other-app', 'preserved'], ['sb-other-auth-token', 'preserved'],
    ]);
    const storage = {
      get length() { return values.size; }, key: (i: number) => [...values.keys()][i],
      removeItem: (name: string) => values.delete(name),
    };
    const replace = vi.fn();
    const unregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    await new Promise<void>(resolve => {
      replace.mockImplementation(() => resolve());
      runInNewContext(script[2], {
        window: { localStorage: storage, sessionStorage: storage, location: { replace }, caches: {} },
        navigator: { serviceWorker: { getRegistrations: async () => [{ unregister }] } },
        caches: { keys: async () => ['old-next-chunks'], delete: deleteCache },
        setTimeout: () => 0,
      });
    });
    expect([...values.keys()]).toEqual(['other-app', 'sb-other-auth-token']);
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith('old-next-chunks');
    expect(replace).toHaveBeenCalledWith('/');
  });
});
