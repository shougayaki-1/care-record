import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordLogout: vi.fn(),
  signOut: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({
  recordLogout: mocks.recordLogout,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: mocks.signOut,
    },
  },
}));

import { logoutAndRedirect, logoutCurrentUser } from './clientLogout';
import { LOGOUT_STEP_TIMEOUT_MS } from './logoutStep';

describe('logoutCurrentUser', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.recordLogout.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.removeItem.mockReset();
    vi.stubGlobal('window', {
      localStorage: {
        removeItem: mocks.removeItem,
      },
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('サーバー側失効、Supabase global signOut、ローカル状態削除を実行する', async () => {
    await logoutCurrentUser();

    expect(mocks.recordLogout).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(mocks.removeItem).toHaveBeenCalledWith('care-record-sidebar-open');
  });

  it('サーバー側失効に失敗してもブラウザ側ログアウトとローカル状態削除を続行する', async () => {
    mocks.recordLogout.mockRejectedValueOnce(new Error('expired'));

    await logoutCurrentUser();

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(mocks.removeItem).toHaveBeenCalledWith('care-record-sidebar-open');
    expect(warnSpy).toHaveBeenCalledWith('server logout bookkeeping failed', expect.any(Error));
  });

  it.each(['returned', 'thrown'])('signOut の %s エラーでも状態削除を続行する', async failure => {
    const error = new Error('offline');
    if (failure === 'returned') mocks.signOut.mockResolvedValue({ error });
    else mocks.signOut.mockRejectedValue(error);
    await logoutCurrentUser();
    expect(mocks.removeItem).toHaveBeenCalledWith('care-record-sidebar-open');
    expect(warnSpy).toHaveBeenCalledWith('supabase signOut failed', error);
  });

  it('監査と signOut が応答しなくてもタイムアウトして状態削除する', async () => {
    vi.useFakeTimers();
    mocks.recordLogout.mockReturnValue(new Promise(() => {}));
    mocks.signOut.mockReturnValue(new Promise(() => {}));
    const logout = logoutCurrentUser();
    await vi.advanceTimersByTimeAsync(LOGOUT_STEP_TIMEOUT_MS * 2);
    await logout;
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(mocks.removeItem).toHaveBeenCalledWith('care-record-sidebar-open');
  });

  it('クライアント処理失敗後もネイティブ POST でサーバー Cookie の復旧に進む', async () => {
    mocks.recordLogout.mockRejectedValue(new Error('expired'));
    mocks.signOut.mockRejectedValue(new Error('offline'));
    const form = { method: '', action: '' };
    const submit = vi.fn();
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: () => form, body: { appendChild } });
    vi.stubGlobal('HTMLFormElement', { prototype: { submit } });
    await logoutAndRedirect();
    expect(form).toEqual({ method: 'post', action: '/api/auth/recover' });
    expect(appendChild).toHaveBeenCalledWith(form);
    expect(submit.mock.instances[0]).toBe(form);
  });
});
