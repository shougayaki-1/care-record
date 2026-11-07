// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ review: vi.fn(), action: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpShiftCancelReview', () => ({ getMcpShiftCancelReview: mocks.review, confirmMcpShiftCancel: mocks.action }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => mocks.confirm }));
import McpShiftCancelPage from './page';
const pending = { status: 'confirmation_required', operation: 'soft_delete', reason: '本人からの依頼', expires_at: '2026-11-01T05:00:00Z',
  before: { title: '予定 A', start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', linked_report_count: 1 },
  references: { organization: { name: '事業所 A' }, client: { name: '利用者 A' }, staffs: [{ name: '担当 A' }] } };
async function renderPage() { await act(async () => { render(<Suspense fallback={<div>読込中</div>}><McpShiftCancelPage params={Promise.resolve({ id: 'proposal' })} /></Suspense>); }); }
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it('shows the target and requires a second explicit confirmation', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: pending }); mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  mocks.action.mockResolvedValue({ ok: true, data: { operation: 'soft_delete', googleSyncStatus: 'pending_delete' } });
  await renderPage();
  expect(await screen.findByText('利用者: 利用者 A')).toBeTruthy();
  expect(screen.getByText(/関連する記録: 1 件/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'この内容で論理削除' }));
  await act(async () => {}); expect(mocks.action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'この内容で論理削除' }));
  expect(await screen.findByText(/Google 同期状態: 削除待ち/)).toBeTruthy();
  expect(mocks.action).toHaveBeenCalledWith('proposal');
});
it('does not offer confirmation for an unidentified target', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending, references: { ...pending.references, client: { name: null } } } });
  await renderPage();
  expect(await screen.findByText(/対象の名前を確認できないため/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容で論理削除' })).toBeNull();
});
