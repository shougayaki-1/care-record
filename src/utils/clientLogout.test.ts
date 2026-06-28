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

import { logoutCurrentUser } from './clientLogout';

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
});
