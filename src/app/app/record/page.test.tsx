// @vitest-environment jsdom
//
// Regression test: getMyShiftsWithStatus returns an expected error for
// a legitimate, common state — an org owner with no linked `staffs`
// row (e.g. a brand-new organization where nobody has registered themselves
// as staff yet). Before the fix, this fetch lived inside the same Promise.all
// as the independent clients fetch, so its rejection rejected the whole batch
// and setClients() never ran, leaving the client list permanently empty even
// though the clients query itself succeeded. Mirrors d7aff24 / ccd1837.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMyShiftsWithStatus } from '@/app/actions/shift';
import { GENERIC_ACTION_ERROR_MESSAGE } from '@/utils/actionResult';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const workspace = vi.hoisted(() => ({
    currentOrg: {
      id: 'org-1',
      role: 'owner',
      effectivePermissions: {
        records: { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
        shifts: { view: 'all', create: 'all', edit: 'all', delete: 'all' },
      },
    },
    userId: 'user-1',
    loading: false,
}));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => workspace }));

// A staff account is not linked to this organization for this user, which is
// the normal, expected state getMyShiftsWithStatus returns.
vi.mock('@/app/actions/shift', () => ({
  getMyShiftsWithStatus: vi.fn().mockResolvedValue({ ok: false, error: { code: 'STAFF_NOT_LINKED', message: 'この事業所にスタッフとして紐付いていません。' } }),
}));

vi.mock('@/lib/supabase', () => {
  const respond = (table: string) => {
    if (table === 'clients') return Promise.resolve({ data: [{ id: 'client-1', name: 'テスト太郎' }], error: null });
    if (table === 'reports') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  const from = (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => respond(table).then(resolve, reject),
    };
    return q;
  };
  return { supabase: { from } };
});

import RecordSelectPage from './page';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RecordSelectPage', () => {
  it('still renders the client list when the shifts fetch fails', async () => {
    render(<RecordSelectPage />);
    await waitFor(() => {
      expect(screen.getByText(/テスト太郎/)).toBeTruthy();
    });
    expect((await screen.findByRole('alert')).textContent).toContain('スタッフとして紐付いていません');
    expect(screen.getByRole('button', { name: '自分のシフトで確認' })).toBeTruthy();
  });

  it('transport の例外があっても利用者一覧を表示し、内部メッセージを出さない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getMyShiftsWithStatus).mockRejectedValueOnce(new Error('Minified React error #441; secret'));
    render(<RecordSelectPage />);
    expect(await screen.findByText(/テスト太郎/)).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain(GENERIC_ACTION_ERROR_MESSAGE);
    expect(document.body.textContent).not.toMatch(/#441|secret/);
  });
});
