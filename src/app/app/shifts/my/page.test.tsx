// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), toast: vi.fn(), push: vi.fn(), org: { id: 'org-1' } }));
vi.mock('@/app/actions/shift', () => ({ getMyShiftsWithStatus: mocks.load }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>calendar</div> }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({
  currentOrg: mocks.org, loading: false,
}) }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: mocks.toast }) }));

import MyShiftsPage from './page';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('MyShiftsPage action states', () => {
  it('displays the normal empty state for successful zero shifts', async () => {
    mocks.load.mockResolvedValue({ ok: true, data: [] });
    render(<MyShiftsPage />);
    expect(await screen.findByText('この月のシフトはありません')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('displays staff-not-linked as a persistent state with the shared recovery form', async () => {
    mocks.load.mockResolvedValue({ ok: false, error: {
      code: 'STAFF_NOT_LINKED', message: 'スタッフアカウントが紐付いていません。事業所設定を確認してください。',
    } });
    render(<MyShiftsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('スタッフアカウントが紐付いていません');
    expect(screen.queryByText('この月のシフトはありません')).toBeNull();
    const form = screen.getByRole('button', { name: 'ログアウトしてやり直す' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/api/auth/recover');
    expect(form?.getAttribute('method')).toBe('post');
    expect(document.body.textContent).not.toContain('441');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it.each(['Minified React error #441', 'synthetic internal details'])(
    'shows only a generic error for a rejection and allows retry: %s', async message => {
      mocks.load.mockRejectedValueOnce(new Error(message)).mockResolvedValue({ ok: true, data: [] });
      render(<MyShiftsPage />);
      expect((await screen.findByRole('alert')).textContent).toBe('シフトの取得に失敗しました。時間をおいて再度お試しください。');
      expect(document.body.textContent).not.toContain(message);
      expect(screen.queryByText('この月のシフトはありません')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '再試行' }));
      expect(await screen.findByText('この月のシフトはありません')).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    },
  );
});

it.each(['FORBIDDEN', 'SESSION_EXPIRED'])('shows %s as a result and offers recovery only for a session failure', async code => {
  mocks.load.mockResolvedValue({ ok: false, error: { code, message: '安全な状態表示' } });
  render(<MyShiftsPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('安全な状態表示');
  expect(screen.queryByText('この月のシフトはありません')).toBeNull();
  const recovery = screen.queryByRole('button', { name: 'ログアウトしてやり直す' });
  if (code === 'SESSION_EXPIRED') expect(recovery?.closest('form')?.getAttribute('action')).toBe('/api/auth/recover');
  else expect(recovery).toBeNull();
});
