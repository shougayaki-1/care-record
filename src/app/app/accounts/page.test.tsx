// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionResultError } from '@/utils/actionResult';
import { FULL_PERMISSIONS } from '@/utils/permissions';
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), fetch: vi.fn(), refresh: vi.fn(), reauth: vi.fn(), grant: vi.fn(), add: vi.fn(), toast: vi.fn(), invite: vi.fn(), updateRoles: vi.fn(), remove: vi.fn(), fetchError: null as unknown }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: mocks.workspace }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('@/hooks/useReauth', () => ({ useReauth: () => ({ requestReauth: mocks.reauth, reauthDialog: null }) }));
vi.mock('@/app/actions/authSecurity', () => ({ takeProviderReauthGrant: mocks.grant }));
vi.mock('@/app/actions/organizationOwners', () => ({ addOrganizationOwner: mocks.add }));
vi.mock('@/components/roles/RoleManagementPanel', () => ({ default: () => null }));
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => false }));
vi.mock('@/hooks/useFetchData', () => ({ useFetchData: () => ({ data, error: mocks.fetchError, loading: false, refetch: mocks.fetch }) }));
vi.mock('@/app/actions/accounts', () => ({ createInvitation: mocks.invite, getAccountOverview: vi.fn(), getInviteStaffCandidates: vi.fn(), getOrgRoles: vi.fn(), updateMemberRoles: mocks.updateRoles, removeAccount: mocks.remove }));
import AccountsPage from './page';
import type { AccountsData } from './types';
import { MemberRoleDialog } from './MemberRoleDialog';
import { OWNER_ADD_RESUME_KEY } from '@/utils/ownerAddResume';
const org = '85000000-0000-4000-8000-000000000001';
const actor = '85000000-0000-4000-8000-000000000002';
const target = '85000000-0000-4000-8000-000000000003';
const initialData: AccountsData = { currentUserId: actor, availableRoles: [], inviteStaffCandidates: [], accountList: [
  { id: actor, name: '現在のオーナー', role: 'owner', roles: [], status: 'active' },
  { id: target, name: '追加対象', role: 'member', roles: [], status: 'active' },
] };
let data: AccountsData;
beforeEach(() => {
  data = structuredClone(initialData);
  vi.resetAllMocks(); mocks.fetchError = null; window.history.replaceState(null, '', '/app/accounts'); sessionStorage.clear();
  mocks.workspace.mockReturnValue({ currentOrg: { id: org, name: '事業所', role: 'owner', effectivePermissions: FULL_PERMISSIONS }, loading: false, refreshWorkspace: mocks.refresh });
  mocks.reauth.mockResolvedValue({ token: 'password-proof' }); mocks.grant.mockResolvedValue({ ok: true, data: { token: 'sso-proof' } });
  mocks.invite.mockResolvedValue({ ok: true, data: { code: 'invitation-code' } });
  mocks.updateRoles.mockResolvedValue({ ok: true, data: undefined });
  mocks.remove.mockResolvedValue({ ok: true, data: undefined });
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

async function openInvite() {
  const view = render(<AccountsPage />);
  fireEvent.click(screen.getByRole('button', { name: '新しい人を招待' }));
  fireEvent.change(await screen.findByLabelText(/招待する人の名前/), { target: { value: '招待する職員' } });
  fireEvent.change(screen.getByLabelText(/招待先メールアドレス/), { target: { value: 'invite@example.test' } });
  return view;
}
async function openMemberMenu(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '追加対象の操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('account operations', () => {
  it('generates an invitation, prevents repeated submission and refreshes the list', async () => {
    const pending = deferred<{ ok: true; data: { code: string } }>();
    mocks.invite.mockReturnValue(pending.promise);
    await openInvite();
    const button = screen.getByRole('button', { name: '招待リンクを発行' });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.invite).toHaveBeenCalledExactlyOnceWith(org, { targetName: '招待する職員', email: 'invite@example.test', roleIds: [], staffId: null });
    expect((screen.getByLabelText(/招待する人の名前/) as HTMLInputElement).disabled).toBe(true);
    await act(async () => pending.resolve({ ok: true, data: { code: 'new-code' } }));
    expect((screen.getByLabelText('招待リンク') as HTMLInputElement).value).toContain('/join?code=new-code');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it('keeps invitation input after failure and allows retry', async () => {
    mocks.invite.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION_ERROR', message: '招待を確認してください' } });
    await openInvite(); fireEvent.click(screen.getByRole('button', { name: '招待リンクを発行' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('招待を確認してください', 'error'));
    expect((screen.getByLabelText(/招待する人の名前/) as HTMLInputElement).value).toBe('招待する職員');
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを発行' }));
    await screen.findByLabelText('招待リンク');
    expect(mocks.invite).toHaveBeenCalledTimes(2);
  });
  it('discards an invitation response after switching organizations', async () => {
    const pending = deferred<{ ok: true; data: { code: string } }>();
    mocks.invite.mockReturnValue(pending.promise);
    const view = await openInvite();
    fireEvent.click(screen.getByRole('button', { name: '招待リンクを発行' }));
    mocks.workspace.mockReturnValue({ currentOrg: { id: 'other-org', name: '別事業所', role: 'owner', effectivePermissions: FULL_PERMISSIONS }, loading: false, refreshWorkspace: mocks.refresh });
    view.rerender(<AccountsPage />);
    await act(async () => pending.resolve({ ok: true, data: { code: 'old-org-code' } }));
    expect(screen.queryByLabelText('招待リンク')).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('edits member roles and refreshes on success', async () => {
    data.availableRoles = [{ id: 'care', name: '介護職員', color: null, is_preset: false, is_dangerous: false }];
    render(<AccountsPage />); await openMemberMenu('権限を変更');
    fireEvent.click(await screen.findByText('介護職員'));
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }));
    await waitFor(() => expect(mocks.updateRoles).toHaveBeenCalledExactlyOnceWith(org, target, ['care']));
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it('keeps role selections on failure and locks repeated submissions', async () => {
    const pending = deferred<{ ok: false; error: { code: string; message: string } }>();
    mocks.updateRoles.mockReturnValueOnce(pending.promise);
    data.availableRoles = [{ id: 'care', name: '介護職員', color: null, is_preset: false, is_dangerous: false }];
    render(<AccountsPage />); await openMemberMenu('権限を変更');
    fireEvent.click(await screen.findByText('介護職員'));
    const save = screen.getByRole('button', { name: '変更を保存' });
    fireEvent.click(save); fireEvent.click(save);
    expect(mocks.updateRoles).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ ok: false, error: { code: 'FORBIDDEN', message: '拒否' } }));
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateRoles).toHaveBeenLastCalledWith(org, target, ['care']));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  });
  it('keeps a new role target open when the previous target response arrives', async () => {
    const pending = deferred<{ ok: true; data: undefined }>();
    mocks.updateRoles.mockReturnValue(pending.promise);
    const close = vi.fn(); const success = vi.fn();
    const props = { orgId: org, selectedAccount: data.accountList[1], currentUserId: actor, availableRoles: [], isOwner: true, onClose: close, onSuccess: success };
    const view = render(<MemberRoleDialog key={target} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }));
    view.rerender(<MemberRoleDialog key="new-target" {...props} selectedAccount={{ ...data.accountList[1], id: 'new-target', name: '次の対象' }} />);
    await act(async () => pending.resolve({ ok: true, data: undefined }));
    expect(screen.getByText('次の対象')).toBeTruthy();
    expect(close).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });
  it('cancels an invitation with its explicit target and status', async () => {
    data.accountList[1] = { ...data.accountList[1], status: 'invited', invitation_code: 'code' };
    const pending = deferred<{ ok: true; data: undefined }>();
    mocks.remove.mockReturnValue(pending.promise);
    render(<AccountsPage />); await openMemberMenu('招待を取り消す');
    const button = await screen.findByRole('button', { name: '取り消す' });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(org, { targetId: target, status: 'invited' });
    await act(async () => pending.resolve({ ok: true, data: undefined }));
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it('keeps removal reviewable after failure', async () => {
    mocks.remove.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: '削除できません' } });
    render(<AccountsPage />); await openMemberMenu('アカウントを削除');
    fireEvent.click(await screen.findByRole('button', { name: '削除する' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('削除できません', 'error'));
    expect(screen.getByRole('button', { name: '削除する' })).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not add an owner if organization changes during reauthentication', async () => {
    const pending = deferred<{ token: string }>(); mocks.reauth.mockReturnValue(pending.promise);
    const view = render(<AccountsPage />); await openMemberMenu('オーナーに追加');
    fireEvent.click(await screen.findByRole('button', { name: 'オーナーに追加' }));
    mocks.workspace.mockReturnValue({ currentOrg: { id: 'other-org', role: 'owner', effectivePermissions: FULL_PERMISSIONS }, loading: false, refreshWorkspace: mocks.refresh });
    view.rerender(<AccountsPage />);
    await act(async () => pending.resolve({ token: 'proof' }));
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('revalidates the owner target after reauthentication', async () => {
    const pending = deferred<{ token: string }>(); mocks.reauth.mockReturnValue(pending.promise);
    const view = render(<AccountsPage />); await openMemberMenu('オーナーに追加');
    fireEvent.click(await screen.findByRole('button', { name: 'オーナーに追加' }));
    data = { ...data, accountList: [data.accountList[0]] };
    view.rerender(<AccountsPage />);
    await act(async () => pending.resolve({ token: 'proof' }));
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('追加対象が変更'), 'error');
  });
});

it('protects the last owner from self removal', async () => {
  render(<AccountsPage />);
  fireEvent.click(screen.getByRole('button', { name: '現在のオーナーの操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'アカウントを削除' }));
  expect(mocks.toast).toHaveBeenCalledWith('あなたは最後のオーナーのため削除（脱退）できません。', 'error');
  expect(screen.queryByRole('button', { name: '削除する' })).toBeNull();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('keeps dangerous roles disabled for non-owners in invitation and role editing', async () => {
  mocks.workspace.mockReturnValue({ currentOrg: { id: org, name: '事業所', role: 'member', effectivePermissions: FULL_PERMISSIONS }, loading: false, refreshWorkspace: mocks.refresh });
  data.availableRoles = [{ id: 'dangerous', name: '危険なロール', color: null, is_preset: false, is_dangerous: true }];
  render(<AccountsPage />);
  fireEvent.click(screen.getByRole('button', { name: '新しい人を招待' }));
  expect((await screen.findByRole('button', { name: '危険なロール' })).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  await openMemberMenu('権限を変更');
  expect((await screen.findByRole('button', { name: '危険なロール' })).getAttribute('aria-disabled')).toBe('true');
});
