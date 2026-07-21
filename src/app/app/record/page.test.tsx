// @vitest-environment jsdom
//
// Regression test: getMyShiftsWithStatus (a withSafeError Server Action) can
// throw for a legitimate, common state — an org owner with no linked `staffs`
// row (e.g. a brand-new organization where nobody has registered themselves
// as staff yet). Before the fix, this fetch lived inside the same Promise.all
// as the independent clients fetch, so its rejection rejected the whole batch
// and setClients() never ran, leaving the client list permanently empty even
// though the clients query itself succeeded. Mirrors d7aff24 / ccd1837.

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
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
  }),
}));

// A staff account is not linked to this organization for this user, which is
// the normal, expected case getMyShiftsWithStatus rejects with.
vi.mock('@/app/actions/shift', () => ({
  getMyShiftsWithStatus: vi.fn().mockRejectedValue(new Error('スタッフアカウントが紐付いていません。事業所設定を確認してください。')),
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

describe('RecordSelectPage', () => {
  it('still renders the client list when the shifts fetch fails', async () => {
    render(<RecordSelectPage />);
    await waitFor(() => {
      expect(screen.getByText(/テスト太郎/)).toBeTruthy();
    });
  });
});
