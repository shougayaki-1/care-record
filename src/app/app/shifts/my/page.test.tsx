// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_ACTION_ERROR_MESSAGE } from '@/utils/actionResult';

const mocks = vi.hoisted(() => ({ load: vi.fn(), toast: vi.fn(), org: { id: 'org-1' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>calendar</div> }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: mocks.org, loading: false }) }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('@/app/actions/shift', () => ({ getMyShiftsWithStatus: mocks.load }));
import MyShiftsPage from './page';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MyShiftsPage', () => {
  it('シフト0件を正常な empty state として表示する', async () => {
    mocks.load.mockResolvedValue({ ok: true, data: [] });
    render(<MyShiftsPage />);
    expect(await screen.findByText('この月のシフトはありません')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('スタッフ未紐付けを明示し、#29 共通の復旧フォームを表示する', async () => {
    mocks.load.mockResolvedValue({ ok: false, error: { code: 'STAFF_NOT_LINKED', message: 'この事業所にスタッフとして紐付いていません。' } });
    render(<MyShiftsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('スタッフとして紐付いていません');
    expect(screen.queryByText('この月のシフトはありません')).toBeNull();
    const form = screen.getByRole('button', { name: 'ログアウトしてやり直す' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/api/auth/recover');
    expect(form?.getAttribute('method')).toBe('post');
    expect(document.body.textContent).not.toContain('#441');
  });

  it('内部エラーは汎用表示にし、再試行成功で empty state に戻る', async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: GENERIC_ACTION_ERROR_MESSAGE } })
      .mockResolvedValueOnce({ ok: true, data: [] });
    render(<MyShiftsPage />);
    expect((await screen.findByRole('alert')).textContent).toBe(GENERIC_ACTION_ERROR_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByText('この月のシフトはありません')).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('transport の例外メッセージを UI に表示しない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.load.mockRejectedValue(new Error('Minified React error #441; private secret'));
    render(<MyShiftsPage />);
    expect((await screen.findByRole('alert')).textContent).toBe(GENERIC_ACTION_ERROR_MESSAGE);
    expect(document.body.textContent).not.toMatch(/#441|private secret/);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('月を切り替えた後に古いリクエストが完了しても状態を上書きしない', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.load.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: [] });
    render(<MyShiftsPage />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByTestId('ChevronRightIcon').closest('button')!);
    await screen.findByText('この月のシフトはありません');
    await act(async () => {
      resolveOld({ ok: false, error: { code: 'STAFF_NOT_LINKED', message: '古いエラー' } });
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
