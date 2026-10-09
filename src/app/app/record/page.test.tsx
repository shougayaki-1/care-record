// @vitest-environment jsdom
//
// Optional shifts must never discard the independent clients list.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), workspace: {
  currentOrg: {
    id: 'org-1', role: 'owner', effectivePermissions: {
      records: { view: 'all', create: 'all', edit: 'all', delete: 'all', approve: 'all' },
      shifts: { view: 'all', create: 'all', edit: 'all', delete: 'all' },
    },
  }, userId: 'user-1', loading: false,
} }));
afterEach(cleanup);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => mocks.workspace,
}));

vi.mock('@/app/actions/shift', () => ({
  getMyShiftsWithStatus: mocks.load,
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
  it.each(['staff missing', 'unexpected failure', 'empty shifts'])('still renders the client list: %s', async state => {
    if (state === 'unexpected failure') mocks.load.mockRejectedValue(new Error('synthetic failure'));
    else mocks.load.mockResolvedValue(state === 'empty shifts' ? { ok: true, data: [] } : {
      ok: false, error: { code: 'STAFF_NOT_LINKED', message: 'スタッフアカウントが紐付いていません。事業所設定を確認してください。' },
    });
    render(<RecordSelectPage />);
    await waitFor(() => {
      expect(screen.getByText(/テスト太郎/)).toBeTruthy();
    });
  });
});
