// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';

const state = vi.hoisted(() => ({
  unread: 2,
  listener: undefined as (() => void) | undefined,
  from: vi.fn(),
  on: vi.fn(),
  removeChannel: vi.fn(),
}));
vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({ orgList: [], currentOrg: null, switchOrg: vi.fn(), userId: 'notification-receiver' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/auth/IdleTimeout', () => ({ default: () => null }));
vi.mock('@/utils/clientLogout', () => ({ logoutAndRedirect: vi.fn() }));
vi.mock('@/app/actions/user', () => ({ markNotificationRead: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: state.from,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'notification-receiver' } } } }) },
    channel: () => {
      const channel = { on: state.on, subscribe: () => channel };
      state.on.mockImplementation((_event, _filter, callback) => {
        state.listener = callback;
        return channel;
      });
      return channel;
    },
    removeChannel: state.removeChannel,
  },
}));
import AppLayout from './AppLayout';

beforeEach(() => {
  vi.clearAllMocks();
  state.unread = 2;
  state.listener = undefined;
  state.from.mockImplementation(() => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { name: 'Fixture account', avatar_url: null } }),
      then: (resolve: (result: { count: number; error: null }) => unknown) => Promise.resolve({ count: state.unread, error: null }).then(resolve),
    };
    return query;
  });
});
afterEach(cleanup);

describe('notification bell Realtime updates', () => {
  it('refreshes the unread count after INSERT and UPDATE instead of blindly incrementing', async () => {
    render(<ThemeProvider theme={theme}><AppLayout aiImportEnabled={false}><p>Application</p></AppLayout></ThemeProvider>);
    await screen.findByRole('button', { name: '通知（未読2件）' });
    expect(state.on).toHaveBeenCalledWith('postgres_changes', {
      event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.notification-receiver',
    }, expect.any(Function));

    state.unread = 3;
    act(() => state.listener?.());
    await screen.findByRole('button', { name: '通知（未読3件）' });
    state.unread = 1;
    act(() => state.listener?.());
    await screen.findByRole('button', { name: '通知（未読1件）' });
  });

  it('removes its subscription and ignores late events after unmount', async () => {
    const view = render(<ThemeProvider theme={theme}><AppLayout aiImportEnabled={false}><p>Application</p></AppLayout></ThemeProvider>);
    await screen.findByRole('button', { name: '通知（未読2件）' });
    const calls = state.from.mock.calls.length;
    view.unmount();
    expect(state.removeChannel).toHaveBeenCalledOnce();
    act(() => state.listener?.());
    expect(state.from.mock.calls).toHaveLength(calls);
  });
});
