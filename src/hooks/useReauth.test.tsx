// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ methods: vi.fn(), password: vi.fn(), provider: vi.fn(), oauth: vi.fn(), done: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth: mocks.oauth } } }));
vi.mock('@/app/actions/authSecurity', () => ({ getReauthMethods: mocks.methods, verifyReauthPassword: mocks.password, startProviderReauth: mocks.provider }));
vi.mock('@/components/auth/ReauthDialog', () => ({ ReauthDialog: (props: {
  onSubmit: (value: string) => Promise<void>; onCancel: () => void; onMethodChange: (value: string) => void; error: string; loading: boolean;
}) => <div>
  <button disabled={props.loading} onClick={() => void props.onSubmit('current-password')}>Verify</button>
  <button onClick={props.onCancel}>Cancel</button>
  <button onClick={() => props.onMethodChange('azure')}>Microsoft</button>
  <span>{props.error}</span>
</div> }));
import { useReauth } from './useReauth';
function Example() {
  const { requestReauth, reauthDialog } = useReauth();
  return <><button onClick={() => void requestReauth('account_delete', { next: '/app/profile' }).then(grant => { if (grant) mocks.done(grant.token); })}>Begin</button>{reauthDialog}</>;
}
beforeEach(() => { vi.resetAllMocks(); mocks.methods.mockResolvedValue({ ok: true, data: ['password', 'azure'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function begin() { render(<Example />); fireEvent.click(screen.getByText('Begin')); await waitFor(() => expect((screen.getByText('Verify') as HTMLButtonElement).disabled).toBe(false)); }
describe('reauth completion and cancellation', () => {
  it('resumes the operation only after verification returns a grant', async () => {
    let resolve!: (value: { ok: true; data: { token: string } }) => void;
    mocks.password.mockReturnValue(new Promise(value => { resolve = value; }));
    await begin(); fireEvent.click(screen.getByText('Verify')); expect(mocks.done).not.toHaveBeenCalled();
    await act(async () => resolve({ ok: true, data: { token: 'proof' } }));
    expect(mocks.done).toHaveBeenCalledWith('proof');
  });
  it('cancel discards an in-flight grant and never resumes a sensitive operation', async () => {
    let resolve!: (value: { ok: true; data: { token: string } }) => void;
    mocks.password.mockReturnValue(new Promise(value => { resolve = value; }));
    await begin(); fireEvent.click(screen.getByText('Verify')); fireEvent.click(screen.getByText('Cancel'));
    await act(async () => resolve({ ok: true, data: { token: 'late-proof' } })); expect(mocks.done).not.toHaveBeenCalled();
  });
  it('a timeout discards late proof and permits a new verification attempt', async () => {
    let resolve!: (value: { ok: true; data: { token: string } }) => void;
    mocks.password.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    await begin(); vi.useFakeTimers(); fireEvent.click(screen.getByText('Verify'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText(/タイムアウト/)).toBeTruthy();
    await act(async () => resolve({ ok: true, data: { token: 'late-proof' } })); expect(mocks.done).not.toHaveBeenCalled();
    mocks.password.mockResolvedValue({ ok: true, data: { token: 'fresh-proof' } });
    await act(async () => { fireEvent.click(screen.getByText('Verify')); });
    expect(mocks.done).toHaveBeenCalledWith('fresh-proof');
  });
  it('provider errors do not execute the operation and Azure forces a login interaction', async () => {
    mocks.provider.mockResolvedValue({ ok: true, data: { nonce: 'nonce', provider: 'azure' } });
    mocks.oauth.mockResolvedValue({ data: { url: null }, error: {} });
    await begin(); fireEvent.click(screen.getByText('Microsoft')); fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText('再認証を開始できません')).toBeTruthy());
    expect(mocks.oauth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'azure', options: expect.objectContaining({ scopes: 'email', skipBrowserRedirect: true, queryParams: { prompt: 'login' } }) }));
    expect(mocks.done).not.toHaveBeenCalled();
  });
});
