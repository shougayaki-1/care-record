// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGOUT_STEP_TIMEOUT_MS } from '@/utils/logoutStep';

const logout = vi.hoisted(() => vi.fn());
vi.mock('@/utils/clientLogout', () => ({ logoutCurrentUser: logout }));
import { RecoveryLogoutButton } from './RecoveryLogoutButton';

beforeEach(() => {
  logout.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('recovery logout action', () => {
  it('既存ログアウト処理の後に native POST へ進む', async () => {
    localStorage.setItem('care-record-sidebar-open', 'false');
    render(<RecoveryLogoutButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ログアウトしてやり直す' }));
      await vi.dynamicImportSettled();
    });
    expect(logout).toHaveBeenCalledOnce();
    expect(localStorage.getItem('care-record-sidebar-open')).toBeNull();
    expect(HTMLFormElement.prototype.submit).toHaveBeenCalledOnce();
  });

  it('クライアント処理が止まってもタイムアウトして native POST へ進む', async () => {
    vi.useFakeTimers();
    logout.mockReturnValue(new Promise(() => {}));
    render(<RecoveryLogoutButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ログアウトしてやり直す' }));
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(LOGOUT_STEP_TIMEOUT_MS);
    });
    expect(HTMLFormElement.prototype.submit).toHaveBeenCalledOnce();
  });

  it('boundary では認証コードを呼ばず、ブラウザのフォーム送信を許可する', () => {
    render(<RecoveryLogoutButton attemptClientLogout={false} />);
    const form = screen.getByRole('button', { name: 'ログアウトしてやり直す' }).closest('form')!;
    expect(fireEvent.submit(form)).toBe(true);
    expect(logout).not.toHaveBeenCalled();
    expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
  });
});
