// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpMasterEdit', () => ({ getMcpMasterEditReview: mocks.review, confirmMcpMasterEdit: mocks.confirm }));
import Page from './page';
const pending = { status: 'confirmation_required', kind: 'staff', target_id: 'staff-id', organization_name: '事業所 A', expires_at: '2026-11-01T05:00:00Z',
  before: { name: '旧名', employment_type: '非常勤', work_style: '兼務' }, proposal: { name: '新名', employment_type: '常勤', work_style: '専従' } };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('compares the target and fixed changes before confirmation', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: pending });
  mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'updated', newly_updated: true } });
  await act(async () => { render(<Suspense fallback="読込中"><Page params={Promise.resolve({ id: 'proposal' })} /></Suspense>); });
  expect(await screen.findByText('変更前の名前: 旧名')).toBeTruthy();
  expect(screen.getByText('変更後の名前: 新名')).toBeTruthy();
  expect(screen.getByText(/対象: スタッフ（ID: staff-id）/)).toBeTruthy();
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'この内容でマスタを変更' }));
  expect(await screen.findByText('マスタを変更しました。')).toBeTruthy();
  expect(mocks.confirm).toHaveBeenCalledWith('proposal');
});
it('does not allow confirmation of a stale proposal', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { status: 'changed' } });
  await act(async () => { render(<Suspense fallback="読込中"><Page params={Promise.resolve({ id: 'proposal' })} /></Suspense>); });
  expect(await screen.findByText(/対象が変更されました/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容でマスタを変更' })).toBeNull();
});
