// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpShiftUpdateBatch', () => ({ getMcpShiftUpdateBatch: mocks.review, confirmMcpShiftUpdateBatch: mocks.confirm }));
import Page from './page';
const pending = { status: 'confirmation_required', expires_at: '2026-11-01T05:00:00Z',
  before: { title: '元の予定', start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', staffs: [], segments: [] },
  proposal: { start_at: '2026-11-01T02:00:00Z', end_at: '2026-11-01T03:00:00Z', segments: [{ start_at: '2026-11-01T02:00:00Z', end_at: '2026-11-01T03:00:00Z', staffs: [{ staff_id: 'staff' }] }] },
  references: { organization: { name: '事業所 A' }, client: { name: '利用者 A' }, staffs: [{ id: 'staff', name: '担当 A' }], staff_roles: [], service_types: [] } };
const batch = { items: [
  { position: 1, proposal_id: 'first', has_overlap: false, has_unassigned: false, review: pending },
  { position: 2, proposal_id: 'second', has_overlap: true, has_unassigned: true, review: pending },
] };
beforeEach(() => { vi.clearAllMocks(); mocks.review.mockResolvedValue({ ok: true, data: batch }); });
afterEach(cleanup);
it('compares proposals and submits only the selected item', async () => {
  mocks.confirm.mockResolvedValue({ ok: true, data: [{ proposalId: 'second', status: 'shift_conflict' }] });
  await act(async () => { render(<Suspense fallback="読込中"><Page params={Promise.resolve({ id: 'batch' })} /></Suspense>); });
  expect(await screen.findByText(/担当者の重複が見つかりました/)).toBeTruthy();
  expect(screen.getByText(/担当として登録されていない/)).toBeTruthy();
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('region', { name: '変更案 2' })).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '選択した 1 件を変更' }));
  expect(await screen.findByText('変更 0 件、失敗 1 件。')).toBeTruthy();
  expect(mocks.confirm).toHaveBeenCalledWith('batch', ['second']);
});
it('does not offer selection when identities cannot be shown', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { items: [{ ...batch.items[0], review: { ...pending, references: { ...pending.references, staffs: [] } } }] } });
  await act(async () => { render(<Suspense fallback="読込中"><Page params={Promise.resolve({ id: 'batch' })} /></Suspense>); });
  expect(await screen.findByText(/対象の名前を確認できない/)).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
});
