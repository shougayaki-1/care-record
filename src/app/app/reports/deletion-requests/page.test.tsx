// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMPTY_PERMISSIONS, FULL_PERMISSIONS } from '@/utils/permissions';
const state = vi.hoisted(() => ({ list: vi.fn(), approve: vi.fn(), reject: vi.fn(), toast: vi.fn(), confirm: vi.fn(), manager: false }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: { id: 'org', effectivePermissions: state.manager ? FULL_PERMISSIONS : EMPTY_PERMISSIONS } }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('requestId=60000000-0000-4000-8000-000000000050') }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: state.toast }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/app/actions/deletionRequests', () => ({ listDeletionRequests: state.list, approveDeletionRequest: state.approve, rejectDeletionRequest: state.reject }));
import DeletionRequestsClientPage from './DeletionRequestsClientPage';
const row = { id: 'request', status: 'requested', requested_at: '2026-10-07T00:00:00Z', reason: 'Synthetic request reason' };
beforeEach(() => {
  vi.clearAllMocks(); state.manager = false;
  state.list.mockResolvedValue({ ok: true, data: [row] }); state.confirm.mockResolvedValue(true);
  state.approve.mockResolvedValue({ ok: true, data: { success: true } }); state.reject.mockResolvedValue({ ok: true, data: { success: true } });
});
afterEach(cleanup);
it('opens a targeted own request without granting management controls', async () => {
  render(<DeletionRequestsClientPage />); await screen.findByText('Synthetic request reason');
  expect(state.list).toHaveBeenCalledWith('org', 'all', '60000000-0000-4000-8000-000000000050');
  expect(screen.queryByRole('button', { name: '承認' })).toBeNull();
});
it('confirms approval and refreshes the request after the Action succeeds', async () => {
  state.manager = true; render(<DeletionRequestsClientPage />);
  fireEvent.click(await screen.findByRole('button', { name: '承認' }));
  await waitFor(() => expect(state.approve).toHaveBeenCalledWith('org', 'request'));
  await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
  expect(state.confirm).toHaveBeenCalledOnce();
});
it('keeps failed decisions available for retry and displays only safe errors', async () => {
  state.manager = true; state.approve.mockRejectedValue(new Error('PHI fixture failure'));
  render(<DeletionRequestsClientPage />); fireEvent.click(await screen.findByRole('button', { name: '承認' }));
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
  expect(state.toast.mock.calls[0][0]).not.toContain('PHI'); expect(state.list).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: '承認' }) as HTMLButtonElement).disabled).toBe(false);
});
it('shows a safe persistent fetch error and offers retry', async () => {
  state.list.mockRejectedValue(new Error('PHI fixture failure')); render(<DeletionRequestsClientPage />);
  expect((await screen.findByRole('alert')).textContent).not.toContain('PHI');
  state.list.mockResolvedValue({ ok: true, data: [row] }); fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await screen.findByText('Synthetic request reason');
});

it('links an accessible request to its existing report detail', async () => {
  state.list.mockResolvedValue({ ok: true, data: [{ ...row, clientId: 'client', resource_id: 'report' }] });
  render(<DeletionRequestsClientPage />);
  expect((await screen.findByRole('link', { name: '記録を確認' })).getAttribute('href')).toMatch(/^\/app\/record\/client\?reportId=report&draftKey=/);
});
