// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  auditReportView: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  discardReportAutosave: vi.fn(),
  getReportImages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  loadReportAutosave: vi.fn().mockResolvedValue({ ok: true, data: null }),
  saveReportAutosave: vi.fn(),
  saveReport: vi.fn(),
  softDeleteReports: vi.fn(),
  transitionReports: vi.fn(),
  uploadReportImage: vi.fn(),
}));
vi.mock('@/app/actions/reportShifts', () => ({
  getLinkedShifts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getShiftSuggestions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
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
import { saveReport, discardReportAutosave } from '@/app/actions/reports';
afterEach(cleanup);

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
    vi.clearAllMocks();
    vi.mocked(discardReportAutosave).mockResolvedValue({ ok: true, data: { success: true } });
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

  // Fallback normalization for direct/deep-link loads with no draftKey in the
  // URL (in-app navigation always supplies one via buildRecordPath(), so this
  // path only exists for e.g. a typed URL or bookmark — see
  // src/utils/recordNavigation.ts).
  it('normalizes the URL with a draftKey when one is missing', () => {
    testState.search = 'reportId=report-a';
    renderHook(() => useRecordForm());

    expect(testState.router.replace).toHaveBeenCalled();
    expect(testState.router.replace.mock.calls[0][0]).toContain('draftKey=');
  });
  it('retains normal record input and the close dialog on failure, then retries without duplicate writes', async () => {
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(testState.requestedReports).toContain('report-a'));
    await act(async () => { testState.reports.get('report-a')?.resolve(report('report-a', '2026-07-19T09:00:00.000Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.handleAnswerChange('note', '保持する入力'); result.current.setServiceTime('1.5'); result.current.setIsDirty(true); });
    act(() => result.current.handleClose()); expect(result.current.openCloseDialog).toBe(true);
    vi.mocked(saveReport).mockRejectedValueOnce(new Error('network unavailable'));
    await act(async () => { await result.current.handleDialogSaveDraft(); });
    expect(result.current.openCloseDialog).toBe(true); expect(result.current.submitting).toBe(false);
    expect(result.current.answers.note).toBe('保持する入力'); expect(result.current.serviceTime).toBe('1.5'); expect(result.current.isDirty).toBe(true);
    expect(testState.router.back).not.toHaveBeenCalled(); expect(testState.showToast).toHaveBeenLastCalledWith(expect.stringContaining('入力内容は保持'), 'error');
    const key = vi.mocked(saveReport).mock.calls[0][0].idempotencyKey;
    const response = deferred<Awaited<ReturnType<typeof saveReport>>>(); vi.mocked(saveReport).mockReturnValueOnce(response.promise);
    let retry!: Promise<void>;
    await act(async () => { retry = result.current.handleDialogSaveDraft(); await result.current.handleDraftSave(); });
    expect(saveReport).toHaveBeenCalledTimes(2); expect(result.current.submitting).toBe(true);
    expect(vi.mocked(saveReport).mock.calls[1][0].idempotencyKey).toBe(key);
    await act(async () => { response.resolve({ ok: true, data: { success: true, reportId: 'report-a', revisionId: 'revision-2', version: 2, replayed: false } }); await retry; });
    expect(result.current.openCloseDialog).toBe(false); expect(result.current.submitting).toBe(false); expect(result.current.isDirty).toBe(false);
    expect(testState.router.back).toHaveBeenCalledOnce(); expect(testState.showToast).toHaveBeenLastCalledWith('下書きを保存しました', 'success');
  });
  it.each(['VERSION_CONFLICT', 'SESSION_EXPIRED'])('keeps normal record input and its retry key on %s', async code => {
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(testState.requestedReports).toContain('report-a'));
    await act(async () => { testState.reports.get('report-a')?.resolve(report('report-a', '2026-07-19T09:00:00.000Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.handleAnswerChange('note', '競合時に保持する入力'); result.current.setIsDirty(true); });
    vi.mocked(saveReport).mockResolvedValueOnce({ ok: false, error: { code: code as 'VERSION_CONFLICT' | 'SESSION_EXPIRED', message: '安全な保存拒否' } });
    await act(async () => { await result.current.handleDraftSave(); });
    expect(result.current.answers.note).toBe('競合時に保持する入力');
    expect(result.current.isDirty).toBe(true);
    expect(result.current.actionError).toBe('安全な保存拒否');
    expect(result.current.actionErrorCause).toMatchObject({ code });
    expect(testState.router.back).not.toHaveBeenCalled();
    expect(discardReportAutosave).not.toHaveBeenCalled();
    const key = vi.mocked(saveReport).mock.calls[0][0].idempotencyKey;
    vi.mocked(saveReport).mockResolvedValueOnce({ ok: true, data: { success: true, reportId: 'report-a', revisionId: 'revision-3', version: 3, replayed: false } });
    await act(async () => { await result.current.handleDraftSave(); });
    expect(vi.mocked(saveReport).mock.calls[1][0].idempotencyKey).toBe(key);
    expect(result.current.actionError).toBeNull();
  });
  it('locks a normal submission while its confirmation is still open', async () => {
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(testState.requestedReports).toContain('report-a'));
    await act(async () => { testState.reports.get('report-a')?.resolve(report('report-a', '2026-07-19T09:00:00.000Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const confirmation = deferred<boolean>(); testState.confirm.mockReturnValueOnce(confirmation.promise);
    let first!: Promise<void>;
    await act(async () => { first = result.current.handleSubmit(); await result.current.handleSubmit(); });
    expect(testState.confirm).toHaveBeenCalledOnce(); expect(saveReport).not.toHaveBeenCalled(); expect(result.current.submitting).toBe(true);
    await act(async () => { confirmation.resolve(false); await first; });
    expect(result.current.submitting).toBe(false); expect(testState.router.push).not.toHaveBeenCalled();
  });

  it('blocks normal save and close immediately while its AI input is being processed', async () => {
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(testState.requestedReports).toContain('report-a'));
    await act(async () => { testState.reports.get('report-a')?.resolve(report('report-a', '2026-07-19T09:00:00.000Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.handleAiProcessingChange(true); await result.current.handleDraftSave(); result.current.handleClose(); });
    expect(saveReport).not.toHaveBeenCalled(); expect(testState.router.back).not.toHaveBeenCalled(); expect(result.current.submitting).toBe(true);
    act(() => result.current.handleAiProcessingChange(false)); expect(result.current.submitting).toBe(false);
  });

});
