// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpShiftUpdateReview', () => ({ getMcpShiftUpdateReview: mocks.review, confirmMcpShiftUpdate: mocks.confirm }));
import McpShiftUpdatePage from './page';

const staffId = '10000000-0000-4000-8000-000000000002';
const roleId = '10000000-0000-4000-8000-000000000003';
const serviceId = '10000000-0000-4000-8000-000000000004';
const pending = {
  status: 'confirmation_required', expires_at: '2026-11-01T05:00:00Z',
  before: { title: '元のシフト名', start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', staffs: [{ staff_id: staffId }],
    segments: [{ id: 'segment', start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', service_type_id: serviceId, source_pattern_segment_id: 'pattern', staffs: [{ staff_id: staffId, staff_role_id: roleId }] }] },
  proposal: { start_at: '2026-11-01T02:00:00Z', end_at: '2026-11-01T03:00:00Z', segments: [{ start_at: '2026-11-01T02:00:00Z', end_at: '2026-11-01T03:00:00Z', service_type_id: serviceId, staffs: [{ staff_id: staffId, staff_role_id: roleId }] }] },
  references: { organization: { name: '事業所 A' }, client: { name: '利用者 A' }, staffs: [{ id: staffId, name: '担当 A' }], staff_roles: [{ id: roleId, name: '役割 A' }], service_types: [{ id: serviceId, name: 'サービス A' }] },
};
async function renderPage() { await act(async () => { render(<Suspense fallback={<div>読込中</div>}><McpShiftUpdatePage params={Promise.resolve({ id: 'proposal' })} /></Suspense>); }); }
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('shows both fixed schedules, identities, roles, and the pattern effect', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: pending });
  await renderPage();
  expect(await screen.findByText('事業所: 事業所 A')).toBeTruthy();
  expect(screen.getByText('利用者: 利用者 A')).toBeTruthy();
  expect(screen.getByRole('region', { name: '変更前' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '変更後' })).toBeTruthy();
  expect(screen.getAllByText('担当: 担当 A（役割: 役割 A）')).toHaveLength(2);
  expect(screen.getByText(/元のパターンとの関連は解除/)).toBeTruthy();
  expect(mocks.confirm).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue({ ok: true, data: { shiftId: 'shift', googleSyncStatus: 'pending_upsert' } });
  fireEvent.click(screen.getByRole('button', { name: 'この内容でシフトを変更' }));
  expect(await screen.findByText(/シフトを変更しました。Google 同期状態: 未同期/)).toBeTruthy();
  expect(mocks.confirm).toHaveBeenCalledWith('proposal');
});

it.each([
  ['expired', '確認期限が切れました。新しい案を作成してください。'],
  ['changed', '対象が変更されました。新しい案を作成してください。'],
])('does not display a stale proposal when status is %s', async (status, message) => {
  mocks.review.mockResolvedValue({ ok: true, data: { status } });
  await renderPage();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByText('利用者: 利用者 A')).toBeNull();
});

it('clears the previous proposal when navigating to another ID', async () => {
  mocks.review.mockResolvedValueOnce({ ok: true, data: pending }).mockReturnValueOnce(new Promise(() => {}));
  let rerender!: ReturnType<typeof render>['rerender'];
  await act(async () => {
    ({ rerender } = render(<Suspense fallback={<div>読込中</div>}><McpShiftUpdatePage params={Promise.resolve({ id: 'first' })} /></Suspense>));
  });
  expect(await screen.findByText('利用者: 利用者 A')).toBeTruthy();
  await act(async () => {
    rerender(<Suspense fallback={<div>読込中</div>}><McpShiftUpdatePage params={Promise.resolve({ id: 'second' })} /></Suspense>);
  });
  expect(screen.queryByText('利用者: 利用者 A')).toBeNull();
  expect(screen.getByLabelText('読み込み中')).toBeTruthy();
});

it('does not allow confirmation when a fixed identity cannot be displayed', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending, references: { ...pending.references, staffs: [{ id: staffId, name: null }] } } });
  await renderPage();
  expect(await screen.findByText(/対象の名前を確認できないため/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容でシフトを変更' })).toBeNull();
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it('does not allow confirmation if an identity is absent from the fixed references', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending, references: { ...pending.references, staffs: [] } } });
  await renderPage();
  expect(await screen.findByText(/対象の名前を確認できないため/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容でシフトを変更' })).toBeNull();
  expect(mocks.confirm).not.toHaveBeenCalled();
});
