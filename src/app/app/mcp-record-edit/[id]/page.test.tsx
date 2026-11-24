// @vitest-environment jsdom
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ review: vi.fn(), confirm: vi.fn() }));
vi.mock('@/app/actions/mcpRecordEditReview', () => ({ getMcpRecordEditReview: mocks.review, confirmMcpRecordEdit: mocks.confirm }));
import McpRecordEditPage from './page';

const pending = {
  status: 'confirmation_required', proposal_id: 'proposal', expires_at: '2026-11-01T05:00:00Z', expected_version: 2,
  references: { organization: { id: 'org', name: '事業所 A' }, client: { id: 'client', name: '利用者 A' },
    report: { id: 'record-id', service_date: '2026-11-01', start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z' }, staffs: [], staff_roles: [], service_types: [], form_schema: null },
  before: { status: 'draft', values: { special_note: '変更前の内容' }, start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', actual_service_type_id: null, actual_staffs: [] },
  proposal: { values: { special_note: '変更後の内容' }, start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-01T01:00:00Z', actual_service_type_id: null, actual_staffs: [] }, reason: '記入漏れ',
};
async function renderPage() { await act(async () => { render(<Suspense fallback={<div>読込中</div>}><McpRecordEditPage params={Promise.resolve({ id: 'proposal' })} /></Suspense>); }); }
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('shows target and both contents before saving a draft', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: pending });
  mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'updated', report_id: 'record-id', version: 3, replayed: false } });
  await renderPage();
  expect(await screen.findByText('利用者: 利用者 A')).toBeTruthy();
  expect(screen.getByText(/記録 ID: record-id/)).toBeTruthy();
  expect(screen.getByText('《特記事項》')).toBeTruthy();
  expect(screen.getByText('変更前の内容')).toBeTruthy();
  expect(screen.getByText('変更後の内容')).toBeTruthy();
  expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'この内容で下書きを保存' }));
  expect(await screen.findByText('下書きを保存しました。')).toBeTruthy();
  expect(mocks.confirm).toHaveBeenCalledWith('proposal');
});

it('explains that a confirmed correction does not modify the approved original', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending, before: { ...pending.before, status: 'approved' } } });
  mocks.confirm.mockResolvedValue({ ok: true, data: { status: 'correction_proposed', report_id: 'record-id', base_version: 2, replayed: false } });
  await renderPage();
  expect(await screen.findByText(/承認済みの記録と版は変更されず/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'この内容を訂正案として保存' }));
  expect(await screen.findByText('訂正案を保存しました。承認済みの記録は変更されていません。')).toBeTruthy();
});

it('prevents confirmation when a changed field cannot be identified', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending, proposal: { ...pending.proposal, values: { unknown_field: 'value' } } } });
  await renderPage();
  expect(await screen.findByText(/変更項目を確認できないため/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容で下書きを保存' })).toBeNull();
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it('shows and confirms a time and staff change even without value changes', async () => {
  const staffId = '10000000-0000-4000-8000-000000000002';
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending,
    references: { ...pending.references, staffs: [{ id: staffId, name: '担当 A' }] },
    proposal: { ...pending.proposal, values: pending.before.values, start_at: '2026-11-01T00:15:00Z', actual_staffs: [{ staff_id: staffId, staff_role_id: null }] },
  } });
  await renderPage();
  expect(await screen.findByRole('region', { name: '日時・担当者の変更' })).toBeTruthy();
  expect(screen.getByText(/担当 A/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'この内容で下書きを保存' })).toBeTruthy();
});

it('blocks confirmation when a changed staff identity is missing', async () => {
  const staffId = '10000000-0000-4000-8000-000000000002';
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending,
    proposal: { ...pending.proposal, actual_staffs: [{ staff_id: staffId, staff_role_id: null }] },
  } });
  await renderPage();
  expect(await screen.findByText(/変更項目を確認できないため/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容で下書きを保存' })).toBeNull();
});

it('shows that a previously saved correction is stale', async () => {
  mocks.review.mockResolvedValue({ ok: true, data: { ...pending, status: 'correction_proposed', before: { ...pending.before, status: 'approved' }, base_changed: true } });
  await renderPage();
  expect(await screen.findByText(/元の記録が変更されています/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'この内容を訂正案として保存' })).toBeNull();
});
