// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ reason: vi.fn() }));
vi.mock('@/app/actions/mcpReportTransition', () => ({ getMcpReportRemandReason: mocks.reason }));
import { McpRemandReason } from './McpRemandReason';
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it('renders the authorized reason and clears it when the remand view is remounted', async () => {
  mocks.reason.mockResolvedValueOnce({ ok: true, data: '内容を確認' });
  const view = render(<McpRemandReason organizationId="org" reportId="report" />);
  expect(await screen.findByText('差戻し理由: 内容を確認')).toBeTruthy();
  view.unmount();
  mocks.reason.mockImplementationOnce(() => new Promise(() => {}));
  render(<McpRemandReason organizationId="org" reportId="report" />);
  expect(screen.queryByText('差戻し理由: 内容を確認')).toBeNull();
});
it('reports a failure without showing a reason', async () => {
  mocks.reason.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: '拒否' } });
  render(<McpRemandReason organizationId="org" reportId="report" />);
  expect(await screen.findByText(/差戻し理由を確認できませんでした/)).toBeTruthy();
});
