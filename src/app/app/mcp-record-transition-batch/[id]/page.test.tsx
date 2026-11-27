// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpReportTransitionBatch', () => ({ getMcpReportTransitionBatchReview: mocks.review, confirmMcpReportTransitionBatch: mocks.confirm }));
import Page from './page';
const item = (id: string, name: string) => ({ status: 'confirmation_required', expires_at: '2026-11-11T05:00:00Z', expected_version: 2,
  references: { organization: { id: 'org', name: '事業所' }, client: { id: 'client', name }, report: { id, service_date: '2026-11-11', start_at: null, end_at: null, status: 'pending' } }, transition: 'approve', reason: null });
async function renderPage() { await act(async () => { render(<Suspense><Page params={Promise.resolve({ id: 'batch' })} /></Suspense>); }); }
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('shows each fixed target and confirms the entire batch only after the click', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { status: 'confirmation_required', batch_id: 'batch', count: 2, expires_at: '2026-11-11T05:00:00Z', items: [item('r1','利用者 A'),item('r2','利用者 B')] } });
  mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'completed', count: 2, items: [], replayed: false } });
  await renderPage();
  expect(await screen.findByText(/利用者 A/)).toBeTruthy();
  expect(screen.getByText(/利用者 B/)).toBeTruthy();
  expect(screen.getByText(/全件を処理しません/)).toBeTruthy();
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '表示した2件を確認して処理' }));
  expect(await screen.findByText('2件を処理しました。')).toBeTruthy();
});
it('does not offer confirmation after a conflict', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { status: 'changed' } });
  await renderPage();
  expect(await screen.findByText(/全件を処理できません/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /確認して処理/ })).toBeNull();
});
