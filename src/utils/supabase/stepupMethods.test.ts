import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), insert: vi.fn(), grant: vi.fn(), challenge: vi.fn() }));
vi.mock('./auth', () => ({ createSessionClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('./serviceRole', () => ({ serviceRoleForStepupReauth: () => ({ from: () => ({ insert: mocks.insert, update: () => mocks.challenge() }) }) }));
vi.mock('./reauth', async () => ({ ...(await import('@/utils/reauthTypes')), issueGrantToken: mocks.grant }));
import { beginStepUpReauth, completeStepUpReauth } from './stepupReauth';

beforeEach(() => { vi.resetAllMocks(); mocks.insert.mockResolvedValue({ error: null }); });
describe('provider-specific step-up', () => {
  it.each(['google', 'azure'] as const)('allows a linked %s even when a password also exists', async provider => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user', identities: [{ provider: 'email' }, { provider }] } }, error: null });
    const result = await beginStepUpReauth('account_password_change', provider);
    expect(result.provider).toBe(provider);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ provider, user_id: 'user', purpose: 'account_password_change' }));
    expect(mocks.insert.mock.calls[0][0].nonce_hash).not.toEqual(result.nonce);
  });
  it('rejects an unlinked or unsupported provider without creating a challenge', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user', identities: [{ provider: 'google' }] } }, error: null });
    await expect(beginStepUpReauth('account_delete', 'azure')).rejects.toThrow('ログイン方法');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('never issues recovery proof through OAuth', async () => {
    await expect(beginStepUpReauth('account_password_reset', 'google')).rejects.toThrow('不正');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('a different OAuth account cannot receive any grant', async () => {
    const query = { eq: vi.fn(() => query), is: vi.fn(() => query), gt: vi.fn(() => query), select: vi.fn(() => query),
      maybeSingle: async () => ({ data: { user_id: 'original', purpose: 'account_delete' }, error: null }) };
    mocks.challenge.mockReturnValue(query);
    await expect(completeStepUpReauth('nonce', 'other', 'session')).rejects.toThrow('一致');
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(query.is).toHaveBeenCalledWith('consumed_at', null);
    expect(query.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
  });
});
