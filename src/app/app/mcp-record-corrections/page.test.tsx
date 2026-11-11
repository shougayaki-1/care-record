// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), workspace: vi.fn() }));
vi.mock('@/app/actions/mcpRecordEditReview', () => ({ listMcpRecordCorrectionProposals: mocks.list }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: mocks.workspace }));
import McpRecordCorrectionsPage from './page';
beforeEach(() => { vi.clearAllMocks(); mocks.workspace.mockReturnValue({ currentOrg: { id: 'org' }, loading: false }); });
afterEach(cleanup);

it('shows saved proposal metadata and a link to its review', async () => {
  mocks.list.mockResolvedValue({ ok: true, data: { proposals: [{ id: 'proposal', report_id: 'report', client_name: '利用者 A', confirmed_at: '2026-11-01T01:00:00Z', base_version: 2 }], has_more: false, offset: 0, limit: 20 } });
  await act(async () => { render(<McpRecordCorrectionsPage />); });
  expect(await screen.findByText(/利用者 A/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '訂正案を確認' }).getAttribute('href')).toBe('/app/mcp-record-edit/proposal');
  expect(mocks.list).toHaveBeenCalledWith('org', 0);
});

it('does not retain a previous organization while the new list loads', async () => {
  mocks.list.mockResolvedValueOnce({ ok: true, data: { proposals: [{ id: 'proposal', report_id: 'report', client_name: '利用者 A', confirmed_at: '2026-11-01T01:00:00Z', base_version: 2 }], has_more: false, offset: 0, limit: 20 } }).mockReturnValueOnce(new Promise(() => {}));
  let rerender!: ReturnType<typeof render>['rerender'];
  await act(async () => { ({ rerender } = render(<McpRecordCorrectionsPage />)); });
  expect(await screen.findByText(/利用者 A/)).toBeTruthy();
  mocks.workspace.mockReturnValue({ currentOrg: { id: 'other' }, loading: false });
  await act(async () => { rerender(<McpRecordCorrectionsPage />); });
  expect(screen.queryByText(/利用者 A/)).toBeNull();
  expect(screen.getByLabelText('読み込み中')).toBeTruthy();
});
