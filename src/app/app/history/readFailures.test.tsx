// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FULL_PERMISSIONS } from '@/utils/permissions';
const mocks = vi.hoisted(() => ({ feed: vi.fn(), work: vi.fn(), toast: vi.fn(), org: { id: 'org', role: 'owner' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: { ...mocks.org, effectivePermissions: FULL_PERMISSIONS }, loading: false }) }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('@/app/actions/recordFeed', () => ({ getMyRecordFeed: mocks.feed }));
vi.mock('@/app/actions/internalWork', () => ({ getInternalWorkPageData: mocks.work }));
vi.mock('@/components/internal-work/InternalWorkDialog', () => ({ default: () => null }));
import HistoryPage from './page';
import InternalWorkPage from '../internal-work/page';
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it.each(['history', 'work'])('does not render empty %s data after a failed read and supports retry', async kind => {
  const load = kind === 'history' ? mocks.feed : mocks.work;
  load.mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN', message: '安全な読取失敗' } })
    .mockResolvedValueOnce({ ok: true, data: kind === 'history' ? [] : { records: [], staffOptions: [] } });
  render(kind === 'history' ? <HistoryPage /> : <InternalWorkPage />);
  expect((await screen.findByText('安全な読取失敗')).closest('[role="alert"]')).toBeTruthy();
  const emptyText = kind === 'history' ? '記録がありません' : 'この月の内勤実績はありません';
  expect(screen.queryByText(emptyText)).toBeNull();
  expect(screen.queryByRole('button', { name: 'ログアウトしてやり直す' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByText(emptyText)).toBeTruthy();
});
