import { beforeEach, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';
const mocks = vi.hoisted(() => ({ user: vi.fn(), tokenUser: vi.fn(), client: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user, getAuthedUserFromAccessToken: mocks.tokenUser, createSessionClient: mocks.client }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));
import { getMyWorkspaces } from './workspace';
beforeEach(() => { vi.resetAllMocks(); mocks.tokenUser.mockResolvedValue({ id: 'user' }); });
it('returns session_expired only for a classified authentication failure', async () => {
  mocks.user.mockRejectedValue(new ExpectedActionError('UNAUTHENTICATED', '認証が必要です'));
  await expect(getMyWorkspaces()).resolves.toMatchObject({ status: 'session_expired' });
  mocks.user.mockRejectedValue(new Error('private network error'));
  await expect(getMyWorkspaces()).resolves.toMatchObject({ status: 'error' });
});
it('does not retry cookie infrastructure failure as a token-session fallback', async () => {
  mocks.user.mockRejectedValue(new Error('private DB failure'));
  await expect(getMyWorkspaces('access-token-fixture')).resolves.toMatchObject({ status: 'error' });
  expect(mocks.tokenUser).not.toHaveBeenCalled();
});
