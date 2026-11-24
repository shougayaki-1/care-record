// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { StrictMode } from 'react';

const mocks = vi.hoisted(() => ({
  callback: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  getSession: vi.fn(),
  query: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: {
    onAuthStateChange: (callback: typeof mocks.callback) => {
      mocks.callback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    getSession: mocks.getSession,
  },
  from: (table: string) => ({ select: () => ({ eq: () => table === 'profiles'
    ? { maybeSingle: () => mocks.query(table) } : mocks.query(table) }) }),
} }));
vi.mock('@/app/actions/user', () => ({ setLastOrganization: vi.fn() }));
vi.mock('@/components/auth/RecoveryLogoutButton', () => ({ RecoveryLogoutButton: () => <button>ログアウト</button> }));

import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';
function Status() { return <div>{useWorkspace().status}</div>; }
const session = { user: { id: 'user' } } as Session;

beforeEach(() => { vi.useFakeTimers(); mocks.callback = null; mocks.getSession.mockReset(); mocks.query.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('workspace initialization', () => {
  it('routes a resolved empty membership separately from an error', async () => {
    mocks.query.mockImplementation((table: string) => Promise.resolve({ data: table === 'profiles' ? null : [], error: null }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('no_membership')).toBeTruthy();
  });

  it('keeps the normal membership flow ready', async () => {
    mocks.query.mockImplementation((table: string) => Promise.resolve({ data: table === 'profiles' ? null : [
      { role: 'owner', organizations: { id: 'org', name: 'Synthetic org' }, organization_member_roles: [] },
    ], error: null }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('handles the initial event after a Strict Mode subscription restart', async () => {
    mocks.query.mockImplementation((table: string) => Promise.resolve({ data: table === 'profiles' ? null : [], error: null }));
    render(<StrictMode><WorkspaceProvider><Status /></WorkspaceProvider></StrictMode>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('no_membership')).toBeTruthy();
  });

  it('shows an error rather than no membership when lookup fails', async () => {
    mocks.query.mockImplementation((table: string) => Promise.resolve(table === 'profiles'
      ? { data: null, error: null } : { data: null, error: { code: 'network' } }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/所属情報を取得できませんでした/)).toBeTruthy();
    expect(screen.getByText('再試行')).toBeTruthy();
    expect(screen.queryByText('no_membership')).toBeNull();
  });

  it('allows retry and logout when the initial auth event never arrives', async () => {
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    mocks.query.mockImplementation((table: string) => Promise.resolve({ data: table === 'profiles' ? null : [], error: null }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText(/タイムアウト/)).toBeTruthy();
    expect(screen.getByText('ログアウト')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('再試行')); });
    expect(screen.getByText('no_membership')).toBeTruthy();
  });

  it('ignores a lookup that completes after timeout and retry', async () => {
    let resolveMembers!: (value: unknown) => void;
    mocks.query.mockImplementation((table: string) => table === 'profiles'
      ? Promise.resolve({ data: null, error: null }) : new Promise(resolve => { resolveMembers = resolve; }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText(/タイムアウト/)).toBeTruthy();
    await act(async () => { resolveMembers({ data: [], error: null }); });
    expect(screen.getByText(/タイムアウト/)).toBeTruthy();
  });

  it('gives a newer lookup its own timeout even while an earlier lookup is pending', async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.query.mockImplementation((table: string) => table === 'profiles'
      ? Promise.resolve({ data: null, error: null }) : new Promise(resolve => { pending.push(resolve); }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); });
    await act(async () => { mocks.callback!('SIGNED_IN', session); await vi.advanceTimersByTimeAsync(0); });
    expect(pending).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.queryByText(/タイムアウト/)).toBeNull();
    await act(async () => { pending[1]({ data: [], error: null }); });
    expect(screen.getByText('no_membership')).toBeTruthy();
    await act(async () => { pending[0]({ data: [], error: null }); });
    expect(screen.getByText('no_membership')).toBeTruthy();
  });


  it('times out a newer pending lookup only after its own deadline', async () => {
    mocks.query.mockImplementation((table: string) => table === 'profiles'
      ? Promise.resolve({ data: null, error: null }) : new Promise(() => {}));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); });
    await act(async () => { mocks.callback!('SIGNED_IN', session); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(14999); });
    expect(screen.queryByText(/タイムアウト/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(/タイムアウト/)).toBeTruthy();
  });

  it('does not restore a pending workspace after sign out', async () => {
    let resolveMembers!: (value: unknown) => void;
    mocks.query.mockImplementation((table: string) => table === 'profiles'
      ? Promise.resolve({ data: null, error: null }) : new Promise(resolve => { resolveMembers = resolve; }));
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { mocks.callback!('SIGNED_OUT', null); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('session_expired')).toBeTruthy();
    await act(async () => { resolveMembers({ data: [], error: null }); });
    expect(screen.getByText('session_expired')).toBeTruthy();
  });

  it('does not let a delayed sign-out check overwrite a newer sign-in', async () => {
    let resolveSession!: (value: unknown) => void;
    mocks.getSession.mockReturnValue(new Promise(resolve => { resolveSession = resolve; }));
    mocks.query.mockImplementation((table: string) => Promise.resolve({ data: table === 'profiles' ? null : [], error: null }));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('SIGNED_OUT', null); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { mocks.callback!('SIGNED_IN', session); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('no_membership')).toBeTruthy();
    await act(async () => { resolveSession({ data: { session: null }, error: null }); });
    expect(screen.getByText('no_membership')).toBeTruthy();
  });

  it('keeps a timeout visible when the initial event arrives late', async () => {
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    await act(async () => { mocks.callback!('INITIAL_SESSION', session); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/タイムアウト/)).toBeTruthy();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('shows recovery when the sign-out session check fails', async () => {
    mocks.getSession.mockRejectedValue(new Error('network failure'));
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { mocks.callback!('SIGNED_OUT', null); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/セッションを確認できませんでした/)).toBeTruthy();
    expect(screen.getByText('再試行')).toBeTruthy();
    expect(screen.getByText('ログアウト')).toBeTruthy();
  });

  it('offers another retry when the session lookup returns an error', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: new Error('network failure') });
    render(<WorkspaceProvider><Status /></WorkspaceProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    await act(async () => { fireEvent.click(screen.getByText('再試行')); });
    expect(screen.getByText(/所属情報を取得できませんでした/)).toBeTruthy();
    expect(screen.getByText('再試行')).toBeTruthy();
    expect(screen.queryByText('session_expired')).toBeNull();
  });

});
