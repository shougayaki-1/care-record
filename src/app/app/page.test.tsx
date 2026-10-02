// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: 'error', refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({
  currentOrg: null, loading: false, status: mocks.status,
  errorMessage: '所属情報を確認できませんでした。', refreshWorkspace: mocks.refresh,
}) }));

import AppPage from './page';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('workspace recovery', () => {
  it.each(['error', 'forbidden'])('%s で再試行とセッションリセットを表示する', status => {
    mocks.status = status;
    render(<AppPage />);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const form = screen.getByRole('button', { name: 'ログアウトしてやり直す' }).closest('form');
    expect(form?.getAttribute('action')).toBe('/api/auth/recover');
    expect(form?.getAttribute('method')).toBe('post');
  });
});
