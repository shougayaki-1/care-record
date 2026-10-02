// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogoutClientState, getLogoutStorageKeys } from './logoutState';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('logout state cleanup', () => {
  it('対象プロジェクトの認証・PKCE・ユーザーキャッシュと UI 状態のみ削除する', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://care.supabase.co');
    const removed = [
      'care-record-sidebar-open', 'sb-care-auth-token', 'sb-care-auth-token.0',
      'sb-care-auth-token.1', 'sb-care-auth-token-user', 'sb-care-auth-token-code-verifier.0',
    ];
    const preserved = ['other-app', 'sb-other-auth-token', 'sb-care-auth-token-unrelated', 'sb-care-auth-token.bad'];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of [...removed, ...preserved]) storage.setItem(key, 'value');
    }
    clearLogoutClientState();
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of removed) expect(storage.getItem(key)).toBeNull();
      for (const key of preserved) expect(storage.getItem(key)).toBe('value');
    }
  });

  it('localStorage にアクセスできなくても sessionStorage を削除する', () => {
    window.sessionStorage.setItem('care-record-sidebar-open', 'false');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearLogoutClientState()).not.toThrow();
    expect(window.sessionStorage.getItem('care-record-sidebar-open')).toBeNull();
  });

  it('環境変数不正でもアプリ状態の削除対象を返す', () => {
    expect(getLogoutStorageKeys('broken')).toEqual(['care-record-sidebar-open']);
  });
});
