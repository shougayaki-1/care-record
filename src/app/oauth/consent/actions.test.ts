import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readActionResult } from '@/utils/actionResult';
import { ExpectedActionError } from '@/utils/errors';
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), approve: vi.fn(), deny: vi.fn(), redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user,
  createSessionClient: vi.fn(async () => ({ rpc: mocks.rpc, auth: { oauth: {
    approveAuthorization: mocks.approve, denyAuthorization: mocks.deny,
  } } })),
}));
import { decideMcpAuthorization, finalizeMcpReauth, prepareMcpReauth } from './actions';
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 'actor' }); mocks.rpc.mockResolvedValue({ data: true, error: null }); });
describe('MCP OAuth human verification Actions', () => {
  it('passes only the hash of a valid one-use proof to the database', async () => {
    const token = 'a'.repeat(43);
    await readActionResult(prepareMcpReauth('request-id', token));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('prepare_mcp_reauth', {
      p_authorization_id: 'request-id', p_token_hash: createHash('sha256').update(token).digest('hex'),
    });
  });
  it('does not approve or redirect without a prepared browser proof', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const form = new FormData(); form.set('authorization_id', 'request-id'); form.set('decision', 'approve');
    await expect(decideMcpAuthorization(form)).rejects.toThrow('本人確認');
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('does not redirect an approved authorization if database finalization fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ error: { message: 'private database detail' } });
    mocks.approve.mockResolvedValue({ data: { redirect_url: 'https://client.invalid/callback' }, error: null });
    const form = new FormData(); form.set('authorization_id', 'request-id'); form.set('decision', 'approve');
    await expect(decideMcpAuthorization(form)).rejects.toThrow('処理に失敗しました');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('authenticates the public finalize Action before any RPC', async () => {
    mocks.user.mockRejectedValue(new ExpectedActionError('UNAUTHENTICATED', 'ログインしてください'));
    await expect(finalizeMcpReauth('request-id')).rejects.toThrow('ログイン');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
