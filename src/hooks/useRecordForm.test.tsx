// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const testState = vi.hoisted(() => ({
  search: 'reportId=report-a&draftKey=test-draft',
  reports: new Map<string, Deferred<{ data: Record<string, unknown> | null; error: null }>>(),
  requestedReports: [] as string[],
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
  workspace: { currentOrg: { id: 'organization-1', role: 'owner', effectivePermissions: {} }, loading: false, userId: 'user-1' },
  showToast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ clientId: 'client-1' }),
  useRouter: () => testState.router,
  useSearchParams: () => new URLSearchParams(testState.search),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => testState.workspace,
}));

vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: testState.showToast }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => testState.confirm }));
vi.mock('@/utils/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/permissions')>()),
  checkRecordPermission: () => false,
}));
vi.mock('@/app/actions/reports', () => ({
  auditReportView: vi.fn().mockResolvedValue(undefined),
  discardReportAutosave: vi.fn(),
  getReportImages: vi.fn().mockResolvedValue([]),
  loadReportAutosave: vi.fn().mockResolvedValue(null),
  saveReportAutosave: vi.fn(),
  saveReport: vi.fn(),
  softDeleteReports: vi.fn(),
  transitionReports: vi.fn(),
  uploadReportImage: vi.fn(),
}));
vi.mock('@/app/actions/reportShifts', () => ({
  getLinkedShifts: vi.fn().mockResolvedValue([]),
  getShiftSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/supabase', () => {
  const responseFor = (table: string, filters: Record<string, unknown>) => {
    if (table === 'reports') {
      const reportId = String(filters.id);
      testState.requestedReports.push(reportId);
      return testState.reports.get(reportId)?.promise;
    }
    if (table === 'report_values') return Promise.resolve({ data: { data: {} }, error: null });
    if (table === 'report_actual_staffs') return Promise.resolve({ data: [], error: null });
    if (table === 'clients') return Promise.resolve({ data: { id: 'client-1', name: 'Client' }, error: null });
    if (table === 'form_templates') return Promise.resolve({ data: null, error: null });
    if (table === 'staffs') return Promise.resolve({ data: [], error: null });
    if (table === 'assignments') return Promise.resolve({ data: [], error: null });
    if (table === 'organizations') return Promise.resolve({ data: { travel_cost_rate_yen_per_km: 20 }, error: null });
    if (table === 'service_types' || table === 'staff_roles') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return query;
      },
      is: () => query,
      order: () => query,
      maybeSingle: () => responseFor(table, filters),
      single: () => responseFor(table, filters),
    };
    query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => responseFor(table, filters)?.then(resolve, reject);
    return query;
  };

  return { supabase: { from } };
});

import { useRecordForm } from './useRecordForm';

const report = (id: string, startAt: string) => ({
  data: {
    id,
    start_at: startAt,
    end_at: '2026-07-19T10:00:00.000Z',
    status: 'draft',
    current_version: 1,
    segment_id: null,
    actual_service_type_id: null,
    shift_id: null,
  },
  error: null,
});

describe('useRecordForm', () => {
  beforeEach(() => {
    testState.search = 'reportId=report-a&draftKey=test-draft';
    testState.reports = new Map([
      ['report-a', deferred()],
      ['report-b', deferred()],
    ]);
    testState.requestedReports = [];
  });

  it('does not let a stale report load overwrite the record selected later', async () => {
    const { result, rerender } = renderHook(() => useRecordForm());

    await waitFor(() => expect(testState.requestedReports).toContain('report-a'));
    testState.search = 'reportId=report-b&draftKey=test-draft';
    rerender();

    await act(async () => {
      testState.reports.get('report-b')?.resolve(report('report-b', '2026-07-20T12:00:00.000Z'));
      await testState.reports.get('report-b')?.promise;
    });
    await waitFor(() => expect(result.current.currentReportId).toBe('report-b'));

    await act(async () => {
      testState.reports.get('report-a')?.resolve(report('report-a', '2026-07-19T12:00:00.000Z'));
      await testState.reports.get('report-a')?.promise;
    });

    expect(result.current.currentReportId).toBe('report-b');
    expect(result.current.startDateTime.slice(0, 10)).toBe('2026-07-20');
  });

  // Regression test: a synchronous router.replace() on mount (to normalize the
  // URL with a draftKey) races with Next.js App Router's pending-push history
  // commit for the navigation that reached this page, causing the browser
  // back button to skip past the list page entirely. See
  // src/hooks/useRecordForm.ts's draftKey-normalization effect.
  it('defers the draftKey-normalizing router.replace past the current tick', async () => {
    vi.useFakeTimers();
    try {
      testState.search = 'reportId=report-a';
      renderHook(() => useRecordForm());

      expect(testState.router.replace).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(0);

      expect(testState.router.replace).toHaveBeenCalledTimes(1);
      expect(testState.router.replace.mock.calls[0][0]).toContain('draftKey=');
    } finally {
      vi.useRealTimers();
    }
  });
});
