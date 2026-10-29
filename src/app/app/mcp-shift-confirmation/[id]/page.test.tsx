// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpShiftCreate', () => ({ getMcpShiftCreateProposal: mocks.get, confirmMcpShiftCreate: mocks.confirm }));
import Page from './page';
const proposal = { proposal_id: 'id', organization_name: '事業所', client_name: '仮の利用者', staff_name: '仮の担当者', start_at: '2026-12-01T00:00:00Z', end_at: '2026-12-01T01:00:00Z', expires_at: '2026-12-01T00:10:00Z', status: 'confirmation_required', shift_id: null };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ ok: true, data: proposal }); mocks.confirm.mockResolvedValue({ ok: true, data: { shiftId: 'shift', googleSyncStatus: 'pending_upsert' } }); });
describe('MCP shift confirmation', () => {
  it('shows the fixed proposal and only creates after the user clicks', async () => {
    await act(async () => { render(<Page params={Promise.resolve({ id: 'id' })} />); });
    expect(await screen.findByText('仮の利用者')).toBeTruthy();
    expect(screen.getByText('仮の担当者')).toBeTruthy();
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'この内容でシフトを登録' }));
    expect(await screen.findByText(/Google同期状態: 未同期/)).toBeTruthy();
    expect(mocks.confirm).toHaveBeenCalledWith('id');
  });
  it('shows a safe conflict and does not claim success', async () => {
    mocks.confirm.mockResolvedValue({ ok: false, error: { code: 'VERSION_CONFLICT', message: '予定が重複しています' } });
    await act(async () => { render(<Page params={Promise.resolve({ id: 'id' })} />); });
    fireEvent.click(await screen.findByRole('button', { name: 'この内容でシフトを登録' }));
    await waitFor(() => expect(screen.getByText('予定が重複しています')).toBeTruthy());
    expect(screen.queryByText(/シフトを登録しました/)).toBeNull();
  });
});
