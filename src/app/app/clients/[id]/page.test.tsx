// @vitest-environment jsdom
//
// Regression test for PR B: a failure of the (throwing) permission-hints Server
// Action must not discard the core client data that loaded successfully.
// Before the fix, getClientAssignmentPermissionHints lived inside the same
// Promise.all as the non-throwing supabase queries, so its rejection rejected the
// whole batch and the client name was silently dropped (catch → console.error).

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/clients/FormBuilderTab', () => ({ FormBuilderTab: () => null }));
vi.mock('@/components/clients/IntegrationsTab', () => ({ IntegrationsTab: () => null }));
vi.mock('@/components/clients/StaffAssignmentTab', () => ({ StaffAssignmentTab: () => null }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'client-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({ currentOrg: { id: 'org-1', role: 'owner', effectivePermissions: {} }, loading: false }),
}));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/app/actions/gas', () => ({ callGasApi: vi.fn() }));

// The permission-hints Server Action rejects (permission denial / DB error).
vi.mock('@/app/actions/clients', () => ({
  getClientAssignmentPermissionHints: vi.fn().mockRejectedValue(new Error('permission hints failed')),
  saveClientAssignments: vi.fn(),
  saveClientForm: vi.fn(),
  updateClientGoogleLink: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  const respond = (table: string) => {
    if (table === 'clients') return Promise.resolve({ data: { name: 'テスト太郎', google_template_id: null }, error: null });
    if (table === 'form_templates') return Promise.resolve({ data: null, error: null });
    if (table === 'staffs') return Promise.resolve({ data: [], error: null });
    if (table === 'assignments') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  const from = (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, is: () => q, order: () => q, neq: () => q,
      single: () => respond(table), maybeSingle: () => respond(table),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => respond(table).then(resolve, reject),
    };
    return q;
  };
  return { supabase: { from } };
});

import ClientSettingsPage from './page';

describe('ClientSettingsPage', () => {
  it('still renders the client name when permission hints fail to load', async () => {
    render(<ClientSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText(/テスト太郎/)).toBeTruthy();
    });
  });
});
