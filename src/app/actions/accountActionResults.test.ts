import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';

const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), from: vi.fn(), rpc: vi.fn(), log: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user, assertOrgPermission: mocks.permission,
  createSessionClient: async () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/utils/supabase/serviceRole', () => ({ serviceRoleForAuthManagement: () => ({}) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/utils/uploadSecurity', () => ({ sanitizeUploadedImage: vi.fn() }));
vi.mock('@/utils/log', () => ({ logError: mocks.log, serializeError: (error: { message: string }) => ({ message: error.message }) }));
import { acceptInvitation, getAccountOverview, getInvitationPreview } from './accounts';
import { createOrganization, deleteUserAccount, setLastOrganization, updateOwnProfile } from './user';

const privateMessage = 'private SQL 権限 fixture';
function query(result: { data: unknown; error: unknown }) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), gt: vi.fn(() => q), maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve) };
  return q;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 'actor', sessionId: 'session' });
  mocks.permission.mockResolvedValue({ userId: 'actor', isOwner: false });
});
describe('account and profile result contracts', () => {
  it('returns unauthenticated as data before updating a profile', async () => {
    mocks.user.mockRejectedValue(new ExpectedActionError('UNAUTHENTICATED', '認証が必要です'));
    await expect(updateOwnProfile('名前')).resolves.toEqual({ ok: false, error: { code: 'UNAUTHENTICATED', message: '認証が必要です' } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps input validation safe and stops before DB writes', async () => {
    await expect(updateOwnProfile('')).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('distinguishes denied membership from a failed lookup', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    await expect(setLastOrganization('org')).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    mocks.from.mockReturnValue(query({ data: null, error: { message: privateMessage } }));
    const result = await setLastOrganization('org');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain(privateMessage);
    expect(mocks.log).toHaveBeenCalledWith('[db:action.user.membership]', expect.objectContaining({ error: { message: privateMessage } }));
  });
  it('does not accept a missing organization RPC result as success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createOrganization('事業所')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('requests new proof without treating a valid login as expired', async () => {
    await expect(deleteUserAccount('')).resolves.toMatchObject({ ok: false, error: { code: 'REAUTH_REQUIRED' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ error: { message: 'account_delete_requires_reauthentication' } });
    await expect(deleteUserAccount('spent')).resolves.toMatchObject({ ok: false, error: { code: 'REAUTH_REQUIRED' } });
  });
  it('distinguishes invalid invitation data from an unavailable preview', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getInvitationPreview('expired')).resolves.toEqual({ ok: true, data: { valid: false } });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: privateMessage } });
    const result = await getInvitationPreview('code');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain(privateMessage);
  });
  it('does not classify an invitation DB outage as invalid input', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invitation_invalid' } });
    await expect(acceptInvitation('expired')).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: privateMessage } });
    await expect(acceptInvitation('code')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  });
  it('does not succeed with an empty organization ID for an already joined invitation', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'already_member' } });
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    await expect(acceptInvitation('code')).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    mocks.from.mockReturnValue(query({ data: null, error: { message: privateMessage } }));
    await expect(acceptInvitation('code')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  });
  it('separates an empty account list from a failed accounts query', async () => {
    mocks.from.mockReturnValue(query({ data: [], error: null }));
    await expect(getAccountOverview('org')).resolves.toEqual({ ok: true, data: { currentUserId: 'actor', accounts: [] } });
    mocks.from.mockReturnValue(query({ data: null, error: { message: privateMessage } }));
    await expect(getAccountOverview('org')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  });
});
