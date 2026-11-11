// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpReportTransition', () => ({ getMcpReportTransitionReview: mocks.review, confirmMcpReportTransition: mocks.confirm }));
import Page from './page';
const pending = { status: 'confirmation_required', proposal_id: 'proposal', expires_at: '2026-11-11T05:00:00Z', expected_version: 2,
  references: { organization: { id: 'org', name: '事業所 A' }, client: { id: 'client', name: '利用者 A' },
    report: { id: 'record', service_date: '2026-11-11', start_at: '2026-11-11T00:00:00Z', end_at: '2026-11-11T01:00:00Z', status: 'approved' } },
  transition: 'remand', reason: '記載を確認してください' };
async function renderPage() { await act(async () => { render(<Suspense fallback={<div>読込中</div>}><Page params={Promise.resolve({ id: 'proposal' })} /></Suspense>); }); }
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('shows the target, version and reason before an explicit confirmation', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: pending });
  mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'remanded', report_id: 'record', replayed: false } });
  await renderPage();
  expect(await screen.findByText('利用者: 利用者 A')).toBeTruthy();
  expect(screen.getByText(/版: 2/)).toBeTruthy();
  expect(screen.getByText(/差戻し理由: 記載を確認してください/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '対象記録を確認' }).getAttribute('href')).toContain('reportId=record');
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'この記録を差戻し' }));
  expect(await screen.findByText('記録を差戻しました。')).toBeTruthy();
  expect(mocks.confirm).toHaveBeenCalledWith('proposal');
});
it('does not offer confirmation for a changed target', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { status: 'changed' } });
  await renderPage();
  expect(await screen.findByText(/対象が変更されました/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この記録を差戻し' })).toBeNull();
});
