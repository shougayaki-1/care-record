import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), signOut: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), neq: vi.fn(), is: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.getUser, createSessionClient: async () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock('./serviceRole', () => ({ serviceRoleForServerSessions: () => ({ from: mocks.from }) }));
import { prepareAccountSecurityChange } from './accountSecurity';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ id: 'actor', sessionId: 'current-session' });
  mocks.from.mockReturnValue({ update: mocks.update }); mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ neq: mocks.neq }); mocks.neq.mockReturnValue({ is: mocks.is });
  mocks.is.mockResolvedValue({ error: null }); mocks.signOut.mockResolvedValue({ error: null });
});
it('revokes only the verified user’s other application sessions and Auth refresh tokens', async () => {
  await expect(prepareAccountSecurityChange()).resolves.toEqual({ id: 'actor', sessionId: 'current-session' });
  expect(mocks.eq).toHaveBeenCalledWith('user_id', 'actor');
  expect(mocks.neq).toHaveBeenCalledWith('auth_session_id', 'current-session');
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' });
});
it('fails closed when application session revocation fails', async () => {
  mocks.is.mockResolvedValue({ error: new Error('private database details') });
  await expect(prepareAccountSecurityChange()).rejects.toThrow('セッションを失効できません');
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it('fails closed when Auth revocation fails', async () => {
  mocks.signOut.mockResolvedValue({ error: new Error('private auth details') });
  await expect(prepareAccountSecurityChange()).rejects.toThrow('セッションを失効できません');
});
