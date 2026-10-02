// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReauthDialog } from './ReauthDialog';
afterEach(cleanup);
describe('CareRecord password reauth dialog', () => {
  it('uses a password-manager field and clears the password after an unsuccessful attempt', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('incorrect'));
    // The hook handles errors; here it resolves after reporting the failure.
    render(<ReauthDialog methods={['password']} method="password" loading={false} error="パスワードが正しくありません"
      onMethodChange={() => {}} onSubmit={password => submit(password).catch(() => {})} onCancel={() => {}} />);
    const field = screen.getByLabelText('現在のパスワード') as HTMLInputElement;
    expect(field.type).toBe('password'); expect(field.autocomplete).toBe('current-password');
    fireEvent.change(field, { target: { value: 'entered-secret' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '本人確認する' })));
    expect(submit).toHaveBeenCalledWith('entered-secret');
    expect(field.value).toBe('');
  });
  it('cancel remains available while verification is loading', () => {
    const cancel = vi.fn();
    render(<ReauthDialog methods={['password']} method="password" loading error={null}
      onMethodChange={() => {}} onSubmit={async () => {}} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' })); expect(cancel).toHaveBeenCalledOnce();
  });
  it('labels Azure as Microsoft rather than Google', async () => {
    render(<ReauthDialog methods={['azure']} method="azure" loading={false} error={null}
      onMethodChange={() => {}} onSubmit={async () => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Microsoftで本人確認' })).toBeTruthy());
    expect(screen.queryByLabelText('現在のパスワード')).toBeNull();
  });
});
