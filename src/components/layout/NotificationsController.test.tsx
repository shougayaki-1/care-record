// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fetch: vi.fn(), read: vi.fn(), push: vi.fn(), close: vi.fn(), refresh: vi.fn(), organization: vi.fn(), workspace: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ order: () => ({ limit: state.fetch }) }) }) } }));
vi.mock('@/app/actions/user', () => ({ markNotificationRead: state.read, setLastOrganization: state.organization }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: { id: 'current-org' }, refreshWorkspace: state.workspace }) }));
import { NotificationsController } from './NotificationsController';

const notification = { id: 'notification', type: 'report.remanded', category: 'action_required', content: '内容を確認してください。', is_read: false, created_at: null, link_url: null as string | null };
let anchor: HTMLButtonElement;
beforeEach(() => {
  vi.clearAllMocks();
  anchor = document.createElement('button'); document.body.append(anchor);
  state.fetch.mockResolvedValue({ data: [notification], error: null });
  state.organization.mockResolvedValue({ ok: true, data: { success: true } });
  state.workspace.mockResolvedValue(undefined);
  state.read.mockResolvedValue({ ok: true, data: { success: true, readAt: '2026-10-04T00:00:00Z' } });
});
afterEach(() => { cleanup(); anchor.remove(); });
function mount(refreshKey = 0) {
  return render(<NotificationsController anchorEl={anchor} onClose={state.close} onRead={state.refresh} refreshKey={refreshKey} />);
}
async function selectNotification() {
  fireEvent.click(await screen.findByRole('button', { name: /内容を確認してください/ }));
}
describe('notification interaction', () => {
  it('marks a linkless notification read in place and refreshes the unread badge', async () => {
    mount(); await selectNotification();
    await screen.findByText('要対応 · 既読');
    expect(state.refresh).toHaveBeenCalledOnce(); expect(state.push).not.toHaveBeenCalled(); expect(state.close).not.toHaveBeenCalled();
    await selectNotification(); expect(state.read).toHaveBeenCalledOnce();
  });
  it('navigates only after successful read and leaves destination authorization to the destination', async () => {
    state.fetch.mockResolvedValue({ data: [{ ...notification, link_url: '/app/reports' }], error: null });
    mount(); await selectNotification();
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/app/reports'));
    expect(state.close).toHaveBeenCalledOnce();
  });
  it('retains the list and unread status on read failure without leaking errors', async () => {
    state.read.mockRejectedValue(new Error('sensitive fixture text'));
    mount(); await selectNotification();
    await screen.findByRole('alert');
    expect(screen.getByText('要対応 · 未読')).toBeTruthy();
    expect(screen.queryByText('sensitive fixture text')).toBeNull();
    expect(state.push).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
  });
  it('refreshes the open list when Realtime changes arrive', async () => {
    const view = mount(); await screen.findByText('要対応 · 未読');
    state.fetch.mockResolvedValue({ data: [{ ...notification, is_read: true }], error: null });
    view.rerender(<NotificationsController anchorEl={anchor} onClose={state.close} onRead={state.refresh} refreshKey={1} />);
    await screen.findByText('要対応 · 既読'); expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it('contains fetch failures in the notification popover', async () => {
    state.fetch.mockRejectedValue(new Error('sensitive fixture text'));
    mount(); await screen.findByRole('alert'); expect(screen.queryByText('sensitive fixture text')).toBeNull();
  });
});

it('selects and refreshes the authorized notification workspace before navigation', async () => {
  state.fetch.mockResolvedValue({ data: [{ ...notification, organization_id: 'other-org', link_url: '/app/reports' }], error: null });
  mount(); await selectNotification();
  await waitFor(() => expect(state.push).toHaveBeenCalledWith('/app/reports'));
  expect(state.organization).toHaveBeenCalledWith('other-org');
  expect(state.workspace).toHaveBeenCalledOnce();
  expect(state.workspace.mock.invocationCallOrder[0]).toBeLessThan(state.push.mock.invocationCallOrder[0]);
});
it('retains a readable notification but refuses navigation after membership loss', async () => {
  state.fetch.mockResolvedValue({ data: [{ ...notification, organization_id: 'removed-org', link_url: '/app/reports' }], error: null });
  state.organization.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'この事業所へのアクセス権がありません' } });
  mount(); await selectNotification(); await screen.findByRole('alert');
  expect(state.push).not.toHaveBeenCalled(); expect(state.workspace).not.toHaveBeenCalled();
});
