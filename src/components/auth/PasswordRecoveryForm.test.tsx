// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), finish: vi.fn(), logout: vi.fn() }));
vi.mock('@/app/actions/authSecurity', () => ({ requestPasswordReset: mocks.request, finishPasswordReset: mocks.finish }));
vi.mock('@/utils/clientLogout', () => ({ logoutCurrentUser: mocks.logout }));
import { PasswordRecoveryForm } from './PasswordRecoveryForm';
beforeEach(() => { vi.resetAllMocks(); mocks.request.mockResolvedValue({ ok: true }); mocks.finish.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
describe('password recovery UI', () => {
  it('shows the same account-independent completion and prevents immediate resending', async () => {
    render(<PasswordRecoveryForm mode="request" />);
    fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'unknown@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '再設定用メールを送信' }));
    await waitFor(() => expect(screen.getByText(/登録されているメールアドレスの場合/)).toBeTruthy());
    const button = screen.getByRole('button', { name: /秒後に再送できます/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button); expect(mocks.request).toHaveBeenCalledOnce();
  });
  it('invalid links offer resending without a password mutation form', () => {
    render(<PasswordRecoveryForm mode="reset" validLink={false} />);
    expect(screen.queryByLabelText('新しいパスワード')).toBeNull();
    expect(screen.getByRole('link', { name: '再設定用メールを再送する' })).toBeTruthy();
  });
  it('validates matching passwords and uses logout only after reset success', async () => {
    render(<PasswordRecoveryForm mode="reset" />);
    const password = screen.getByLabelText(/^新しいパスワード[\s*]*$/) as HTMLInputElement;
    const confirmation = screen.getByLabelText(/新しいパスワード（確認）/);
    fireEvent.change(password, { target: { value: 'new-password' } });
    fireEvent.change(confirmation, { target: { value: 'mismatch' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを再設定' }));
    expect(mocks.finish).not.toHaveBeenCalled(); expect(mocks.logout).not.toHaveBeenCalled();
    fireEvent.change(confirmation, { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを再設定' }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    expect(mocks.finish).toHaveBeenCalledWith('new-password', 'new-password'); expect(password.value).toBe('');
  });
});
