// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionResultError } from '@/utils/actionResult';
import { FULL_PERMISSIONS } from '@/utils/permissions';
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), fetch: vi.fn(), refresh: vi.fn(), reauth: vi.fn(), grant: vi.fn(), add: vi.fn(), toast: vi.fn(), fetchError: null as unknown }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: mocks.workspace }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('@/hooks/useReauth', () => ({ useReauth: () => ({ requestReauth: mocks.reauth, reauthDialog: null }) }));
vi.mock('@/app/actions/authSecurity', () => ({ takeProviderReauthGrant: mocks.grant }));
vi.mock('@/app/actions/organizationOwners', () => ({ addOrganizationOwner: mocks.add }));
vi.mock('@/components/roles/RoleManagementPanel', () => ({ default: () => null }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => false }));
vi.mock('@/hooks/useFetchData', () => ({ useFetchData: () => ({ data, error: mocks.fetchError, loading: false, refetch: mocks.fetch }) }));
vi.mock('@/app/actions/accounts', () => ({ createInvitation: vi.fn(), getAccountOverview: vi.fn(), getInviteStaffCandidates: vi.fn(), getOrgRoles: vi.fn(), updateMemberRoles: vi.fn(), removeAccount: vi.fn() }));
import AccountsPage from './page';
import { OWNER_ADD_RESUME_KEY } from '@/utils/ownerAddResume';
const org = '85000000-0000-4000-8000-000000000001';
const actor = '85000000-0000-4000-8000-000000000002';
const target = '85000000-0000-4000-8000-000000000003';
const data = { currentUserId: actor, availableRoles: [], inviteStaffCandidates: [], accountList: [
  { id: actor, name: '現在のオーナー', role: 'owner', roles: [], status: 'active' },
  { id: target, name: '追加対象', role: 'member', roles: [], status: 'active' },
] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.fetchError = null; window.history.replaceState(null, '', '/app/accounts'); sessionStorage.clear();
  mocks.workspace.mockReturnValue({ currentOrg: { id: org, name: '事業所', role: 'owner', effectivePermissions: FULL_PERMISSIONS }, loading: false, refreshWorkspace: mocks.refresh });
  mocks.reauth.mockResolvedValue({ token: 'password-proof' }); mocks.grant.mockResolvedValue({ ok: true, data: { token: 'sso-proof' } });
  mocks.add.mockResolvedValue({ ok: true, data: { success: true } });
});
afterEach(cleanup);
async function openAddition() {
  render(<AccountsPage />); fireEvent.click(screen.getByRole('button', { name: '追加対象の操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'オーナーに追加' }));
  return screen.findByRole('button', { name: 'オーナーに追加' });
}
describe('owner addition UI', () => {
  it('does not expose addition to a non-owner with accounts permission', async () => {
    mocks.workspace.mockReturnValue({ currentOrg: { id: org, role: 'member', effectivePermissions: FULL_PERMISSIONS }, loading: false });
    render(<AccountsPage />); fireEvent.click(screen.getByRole('button', { name: '追加対象の操作' }));
    await screen.findByRole('menuitem', { name: '権限を変更' });
    expect(screen.queryByRole('menuitem', { name: 'オーナーに追加' })).toBeNull();
  });
  it('shows ownership impact and cancels without reauth or mutation', async () => {
    await openAddition(); expect(screen.getByText(/現在のオーナーは引き続きオーナー/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(mocks.reauth).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it('adds after password proof and refreshes accounts and workspace', async () => {
    fireEvent.click(await openAddition());
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(org, target, 'password-proof'));
    expect(mocks.reauth).toHaveBeenCalledWith('owner_add', expect.objectContaining({ next: expect.stringContaining('/app/accounts?stepup=1') }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce()); expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it('does not add after canceled or failed reauthentication', async () => {
    mocks.reauth.mockResolvedValue(null); fireEvent.click(await openAddition());
    await waitFor(() => expect(mocks.reauth).toHaveBeenCalledOnce()); expect(mocks.add).not.toHaveBeenCalled();
  });
  it('keeps failed additions reviewable and does not refresh success state', async () => {
    mocks.add.mockResolvedValue({ ok: false, error: { code: 'REAUTH_REQUIRED', message: '再認証証明が無効です' } });
    fireEvent.click(await openAddition());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('再認証証明が無効です', 'error'));
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'オーナーに追加' })).toBeTruthy();
  });
  it('resumes SSO into confirmation and adds only after another explicit click', async () => {
    window.history.replaceState(null, '', `/app/accounts?stepup=1&action=owner_add&reauthOrg=${org}&target=${target}`);
    sessionStorage.setItem(OWNER_ADD_RESUME_KEY, JSON.stringify({ orgId: org, actorId: actor, targetId: target }));
    render(<AccountsPage />);
    const button = await screen.findByRole('button', { name: 'オーナーに追加' });
    expect(mocks.add).not.toHaveBeenCalled(); fireEvent.click(button);
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(org, target, 'sso-proof'));
    expect(mocks.reauth).not.toHaveBeenCalled();
  });
  it('rejects an SSO return with a different target', async () => {
    window.history.replaceState(null, '', `/app/accounts?stepup=1&action=owner_add&reauthOrg=${org}&target=${actor}`);
    sessionStorage.setItem(OWNER_ADD_RESUME_KEY, JSON.stringify({ orgId: org, actorId: actor, targetId: target }));
    render(<AccountsPage />);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('追加対象を確認できません'), 'error'));
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('prevents double submission while addition is pending', async () => {
    let resolve!: (value: { ok: true; data: { success: boolean } }) => void;
    mocks.add.mockReturnValue(new Promise(done => { resolve = done; }));
    const button = await openAddition(); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.add).toHaveBeenCalledOnce());
    await act(async () => resolve({ ok: true, data: { success: true } }));
  });
});


it.each(['FORBIDDEN', 'SESSION_EXPIRED'])('renders classified read failure %s without empty accounts or invite controls', code => {
  mocks.fetchError = new ActionResultError(code, '安全な失敗文言');
  render(<AccountsPage />);
  expect(screen.getByRole('alert').textContent).toContain('安全な失敗文言');
  expect(screen.queryByText('アカウントがありません')).toBeNull();
  expect(screen.queryByRole('button', { name: '新しい人を招待' })).toBeNull();
  if (code === 'SESSION_EXPIRED') {
    expect(screen.getByRole('button', { name: 'ログアウトしてやり直す' }).closest('form')?.getAttribute('action')).toBe('/api/auth/recover');
  } else {
    expect(screen.queryByRole('button', { name: 'ログアウトしてやり直す' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(mocks.fetch).toHaveBeenCalledOnce();
  }
});
