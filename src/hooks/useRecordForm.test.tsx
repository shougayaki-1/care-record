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
  base: null as Deferred<{ data: { id: string; name: string }; error: null }> | null,
  valuesError: null as { message: string } | null,
  tableResults: new Map<string, Promise<{ data: unknown; error: { message: string } | null }>>(),
  existingShiftReportId: null as string | null,
  clientId: 'client-1',
  search: 'reportId=report-a&draftKey=test-draft',
  reports: new Map<string, Deferred<{ data: Record<string, unknown> | null; error: null }>>(),
  requestedReports: [] as string[],
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
  workspace: { currentOrg: { id: 'organization-1', role: 'owner', effectivePermissions: {} }, loading: false, userId: 'user-1' },
  showToast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ clientId: testState.clientId }),
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
    const override = testState.tableResults.get(table);
    if (override) return override;
    if (table === 'reports') {
      if (!filters.id) return Promise.resolve({ data: testState.existingShiftReportId ? { id: testState.existingShiftReportId } : null, error: null });
      const reportId = String(filters.id);
      testState.requestedReports.push(reportId);
      return testState.reports.get(reportId)?.promise;
    }
    if (table === 'report_values') return Promise.resolve({ data: { data: { note: String(filters.report_id) } }, error: testState.valuesError });
    if (table === 'report_actual_staffs') return Promise.resolve({ data: [], error: null });
    if (table === 'clients' && testState.base) return testState.base.promise;
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
import { auditReportView, getReportImages, uploadReportImage, saveReport, discardReportAutosave, loadReportAutosave } from '@/app/actions/reports';
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
    vi.mocked(auditReportView).mockReset().mockResolvedValue({ ok: true, data: undefined });
    vi.mocked(getReportImages).mockReset().mockResolvedValue({ ok: true, data: [] });
    vi.mocked(loadReportAutosave).mockReset().mockResolvedValue({ ok: true, data: null });
    testState.base = null;
    testState.valuesError = null;
    testState.tableResults = new Map();
    testState.existingShiftReportId = null;
    testState.clientId = 'client-1';
    testState.workspace = { currentOrg: { id: 'organization-1', role: 'owner', effectivePermissions: {} }, loading: false, userId: 'user-1' };
    vi.mocked(discardReportAutosave).mockResolvedValue({ ok: true, data: { success: true } });
    testState.search = 'reportId=report-a&draftKey=test-draft';
    testState.reports = new Map([
      ['report-a', deferred()],
      ['report-b', deferred()],
    ]);
    testState.requestedReports = [];
  });

  it('starts report loading while base data is still pending', async () => {
    testState.base = deferred();
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(testState.requestedReports).toContain('report-a'));
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(auditReportView).toHaveBeenCalledWith('organization-1', 'report-a'));
    expect(result.current.loading).toBe(true);
    await act(async () => { testState.base!.resolve({ data: { id: 'client-1', name: 'Client' }, error: null }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.answers.note).toBe('report-a');
  });

  it.each(['clients', 'form_templates', 'staffs', 'assignments', 'service_types', 'staff_roles'])('keeps the form closed on a %s read failure and allows retry', async table => {
    testState.tableResults.set(table, Promise.resolve({ data: null, error: { message: 'private query failure' } }));
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.loading).toBe(true);
    expect(getReportImages).not.toHaveBeenCalled();
    testState.tableResults.delete(table);
    await act(async () => { result.current.retryLoad(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBeNull();
    expect(result.current.answers.note).toBe('report-a');
  });

  it('starts an unlinked new record with the current staff and configured travel cost', async () => {
    testState.search = 'draftKey=test-draft';
    testState.tableResults.set('staffs', Promise.resolve({ data: [{ id: 'staff', name: 'Staff', user_id: 'user-1' }], error: null }));
    testState.tableResults.set('assignments', Promise.resolve({ data: [{ staff_id: 'staff', default_travel_cost_yen: 250 }], error: null }));
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentReportId).toBeNull();
    expect(result.current.currentStatus).toBe('draft');
    expect(result.current.actualStaffs).toEqual([{ staff_id: 'staff', staff_role_id: null }]);
    expect(result.current.travelExpenses).toEqual({ staff: { method: 'car', amountYen: '250' } });
    expect(new Date(result.current.endDateTime).getTime() - new Date(result.current.startDateTime).getTime()).toBe(3600000);
    expect(auditReportView).not.toHaveBeenCalled();
    expect(getReportImages).not.toHaveBeenCalled();
  });

  it('selects the sole shift segment and keeps its staff, service and draft identity', async () => {
    testState.search = 'shiftId=shift-1&draftKey=test-draft';
    testState.tableResults.set('shifts', Promise.resolve({ data: {
      start_at: '2026-10-22T01:00:00Z', end_at: '2026-10-22T02:00:00Z', shift_staffs: [],
      shift_segments: [{ id: 'segment-1', start_at: '2026-10-22T01:00:00Z', end_at: '2026-10-22T02:00:00Z', service_type_id: 'service', shift_segment_staffs: [{ staff_id: 'staff', staff_role_id: 'role', staff: { name: 'Staff' } }] }],
    }, error: null }));
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedSegmentId).toBe('segment-1');
    expect(result.current.actualServiceTypeId).toBe('service');
    expect(result.current.actualStaffs).toEqual([{ staff_id: 'staff', staff_role_id: 'role' }]);
    expect(result.current.selectedHelpers).toEqual(['Staff']);
    expect(result.current.serviceTime).toBe('1');
    expect(testState.router.replace).toHaveBeenCalledWith('/app/record/client-1?shiftId=shift-1&segmentId=segment-1&draftKey=test-draft');
    expect(auditReportView).not.toHaveBeenCalled();
  });

  it('loads the existing report for a shift segment and preserves its content version on save', async () => {
    testState.search = 'shiftId=shift-1&segmentId=segment-1&draftKey=test-draft';
    testState.existingShiftReportId = 'report-a';
    testState.tableResults.set('shifts', Promise.resolve({ data: {
      start_at: '2026-10-22T01:00:00Z', end_at: '2026-10-22T02:00:00Z', shift_staffs: [], shift_segments: [],
    }, error: null }));
    const response = report('report-a', '2026-07-20T12:00:00Z');
    response.data.current_version = 7;
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(response); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentReportId).toBe('report-a');
    expect(auditReportView).toHaveBeenCalledWith('organization-1', 'report-a');
    expect(testState.router.replace).toHaveBeenCalledWith('/app/record/client-1?reportId=report-a&shiftId=shift-1&segmentId=segment-1&draftKey=test-draft');
    vi.mocked(saveReport).mockResolvedValue({ ok: true, data: { success: true, reportId: 'report-a', revisionId: 'revision-8', version: 8, replayed: false } });
    await act(async () => { await result.current.handleDraftSave(); });
    expect(saveReport).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7 }));
  });

  it('requires choosing a segment when a new shift has several segments', async () => {
    testState.search = 'shiftId=shift-1&draftKey=test-draft';
    testState.tableResults.set('shifts', Promise.resolve({ data: {
      start_at: '2026-10-22T01:00:00Z', end_at: '2026-10-22T03:00:00Z', shift_staffs: [],
      shift_segments: ['segment-2', 'segment-1'].map((id, index) => ({ id, start_at: `2026-10-22T0${2-index}:00:00Z`, end_at: '2026-10-22T03:00:00Z' })),
    }, error: null }));
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.requiresSegmentSelection).toBe(true);
    expect(result.current.shiftSegments.map(segment => segment.id)).toEqual(['segment-1', 'segment-2']);
    expect(result.current.currentStatus).toBe('draft');
    expect(testState.router.replace).not.toHaveBeenCalled();
  });

  it('keeps the first month portion for a shift spanning a month boundary', async () => {
    testState.search = 'shiftId=shift-1&draftKey=test-draft';
    testState.tableResults.set('shifts', Promise.resolve({ data: {
      start_at: new Date(2026, 9, 31, 23).toISOString(), end_at: new Date(2026, 10, 1, 1).toISOString(),
      shift_staffs: [{ staff_id: 'staff', staffs: { name: 'Staff' } }], shift_segments: [],
    }, error: null }));
    const { result } = renderHook(() => useRecordForm());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSpanningMonth).toBe(true);
    expect(result.current.selectedPart).toBe('part1');
    expect(result.current.endDateTime).toBe('2026-11-01T00:00');
    expect(result.current.serviceTime).toBe('1');
    expect(result.current.selectedHelpers).toEqual(['Staff']);
  });

  it('ignores a pending shift response after navigating to another report', async () => {
    testState.search = 'shiftId=shift-1&draftKey=test-draft';
    const shift = deferred<{ data: unknown; error: null }>();
    testState.tableResults.set('shifts', shift.promise);
    const { result, rerender } = renderHook(() => useRecordForm());
    testState.search = 'reportId=report-b&draftKey=test-draft';
    rerender();
    await act(async () => { testState.reports.get('report-b')!.resolve(report('report-b', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { shift.resolve({ data: { shift_segments: [{ id: 'old-segment' }] }, error: null }); });
    expect(result.current.currentReportId).toBe('report-b');
    expect(result.current.shiftSegments).toEqual([]);
    expect(testState.router.replace).not.toHaveBeenCalled();
  });

  it('requires the body audit but does not wait for slow images', async () => {
    const audit = deferred<{ ok: true; data: undefined }>();
    const images = deferred<{ ok: true; data: { id: string; url: string }[] }>();
    vi.mocked(auditReportView).mockReturnValue(audit.promise);
    vi.mocked(getReportImages).mockReturnValue(images.promise);
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(auditReportView).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);
    expect(result.current.answers).toEqual({});
    expect(getReportImages).not.toHaveBeenCalled();
    await act(async () => { audit.resolve({ ok: true, data: undefined }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.answers.note).toBe('report-a');
    expect(result.current.imagesLoading).toBe(true);
    await act(async () => { images.resolve({ ok: true, data: [{ id: 'image-a', url: 'https://example.invalid/a' }] }); });
    await waitFor(() => expect(result.current.imagesLoading).toBe(false));
    expect(result.current.images).toHaveLength(1);
  });

  it.each([{ staff: { name: 'Staff' } }, { staff: [{ name: 'Staff' }] }])('preserves legacy staff names and a single staff travel cost for relation $staff', async ({ staff }) => {
    testState.tableResults.set('report_actual_staffs', Promise.resolve({ data: [{ staff_id: 'staff', staff_role_id: 'role', staff }], error: null }));
    testState.tableResults.set('report_values', Promise.resolve({ data: { data: { note: 'legacy', service_time: '2', travel_time: '0.5', travel_cost_yen: 500 } }, error: null }));
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedHelpers).toEqual(['Staff']);
    expect(result.current.actualStaffs).toEqual([{ staff_id: 'staff', staff_role_id: 'role' }]);
    expect(result.current.travelExpenses).toEqual({ staff: { method: 'car', amountYen: '500' } });
    expect(result.current.serviceTime).toBe('2');
    expect(result.current.travelTime).toBe('0.5');
    expect(result.current.answers.note).toBe('legacy');
  });

  it('preserves per-staff travel expenses and helper fallback from stored values', async () => {
    testState.tableResults.set('report_values', Promise.resolve({ data: { data: {
      _helpers: ['Legacy Staff'], travel_cost_yen: 999,
      travel_expenses: [{ staff_id: 'staff-a', method: 'public_transport', amount_yen: 0 }, { staff_id: 'staff-b', method: 'none', amount_yen: null }],
    } }, error: null }));
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedHelpers).toEqual(['Legacy Staff']);
    expect(result.current.travelExpenses).toEqual({
      'staff-a': { method: 'public_transport', amountYen: '0' }, 'staff-b': { method: 'none', amountYen: '' },
    });
  });

  it('keeps a missing values row distinct from a query failure', async () => {
    testState.tableResults.set('report_values', Promise.resolve({ data: null, error: null }));
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.answers).toEqual({});
    expect(result.current.loadError).toBeNull();
    expect(auditReportView).toHaveBeenCalledWith('organization-1', 'report-a');
  });

  it('fails closed on audit failure and permits a complete retry', async () => {
    vi.mocked(auditReportView).mockRejectedValueOnce(new Error('audit unavailable'));
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.loading).toBe(true);
    expect(result.current.answers).toEqual({});
    expect(getReportImages).not.toHaveBeenCalled();
    await act(async () => { result.current.retryLoad(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBeNull();
    expect(auditReportView).toHaveBeenCalledTimes(2);
  });

  it('retries images independently without reloading or overwriting edited body data', async () => {
    vi.mocked(getReportImages).mockRejectedValueOnce(new Error('image unavailable'));
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.imagesError).not.toBeNull());
    expect(result.current.loading).toBe(false);
    await act(async () => { result.current.handleAnswerChange('note', 'edited'); result.current.retryImages(); });
    await waitFor(() => expect(result.current.imagesError).toBeNull());
    expect(getReportImages).toHaveBeenCalledTimes(2);
    expect(auditReportView).toHaveBeenCalledTimes(1);
    expect(result.current.answers.note).toBe('edited');
    expect(testState.requestedReports).toEqual(['report-a']);
  });

  it('refreshes only images after upload and keeps unsaved answers', async () => {
    vi.mocked(uploadReportImage).mockResolvedValue({ ok: true, data: { success: true, imageId: 'new-image' } });
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(getReportImages).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.handleAnswerChange('note', 'unsaved'); });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'test.png', { type: 'image/png' })] });
    await act(async () => { await result.current.handleImageUpload({ target: input } as React.ChangeEvent<HTMLInputElement>); });
    await waitFor(() => expect(getReportImages).toHaveBeenCalledTimes(2));
    expect(result.current.answers.note).toBe('unsaved');
    expect(result.current.isDirty).toBe(true);
    expect(testState.requestedReports).toEqual(['report-a']);
  });

  it('restores the complete autosaved form and clears its state only after a successful commit', async () => {
    const payload = {
      answers: { note: 'restored input' }, selectedHelpers: ['Staff'],
      actualStaffs: [{ staff_id: 'staff', staff_role_id: null }], actualServiceTypeId: 'service',
      startDateTime: '2026-10-22T10:00', endDateTime: '2026-10-22T11:00',
      serviceTime: '1', travelTime: '0.5', travelExpenses: { staff: { method: 'car' as const, amountYen: '100' } },
    };
    vi.mocked(loadReportAutosave).mockResolvedValue({ ok: true, data: { payload, autosave_revision: 3 } });
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.autosaveState).toBe('saved'));
    expect(result.current).toMatchObject({ ...payload, isDirty: true });
    vi.mocked(saveReport).mockResolvedValue({ ok: true, data: { success: true, reportId: 'report-a', revisionId: 'revision-2', version: 2, replayed: false } });
    await act(async () => { await result.current.handleDraftSave(); });
    expect(discardReportAutosave).toHaveBeenCalledWith('organization-1', 'test-draft');
    expect(result.current.autosaveState).toBe('idle');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.answers.note).toBe('restored input');
  });

  it('ignores images from an earlier body load even when the record scope is unchanged', async () => {
    const oldImages = deferred<{ ok: true; data: { id: string; url: string }[] }>();
    vi.mocked(getReportImages).mockReturnValueOnce(oldImages.promise)
      .mockResolvedValueOnce({ ok: true, data: [{ id: 'new-image', url: 'https://example.invalid/new' }] });
    const { result } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(getReportImages).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.retryLoad(); });
    await waitFor(() => expect(result.current.images).toEqual([{ id: 'new-image', url: 'https://example.invalid/new' }]));
    await act(async () => { oldImages.resolve({ ok: true, data: [{ id: 'old-image', url: 'https://example.invalid/old' }] }); });
    expect(result.current.images).toEqual([{ id: 'new-image', url: 'https://example.invalid/new' }]);
    expect(auditReportView).toHaveBeenCalledTimes(2);
  });

  it('discards a pending image response across organization changes', async () => {
    const images = deferred<{ ok: true; data: { id: string; url: string }[] }>();
    vi.mocked(getReportImages).mockReturnValueOnce(images.promise);
    const { result, rerender } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(getReportImages).toHaveBeenCalledTimes(1));
    testState.workspace = { ...testState.workspace, currentOrg: { ...testState.workspace.currentOrg, id: 'organization-2' } };
    testState.search = 'reportId=report-b&draftKey=test-draft';
    rerender();
    await act(async () => { testState.reports.get('report-b')!.resolve(report('report-b', '2026-07-21T12:00:00Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { images.resolve({ ok: true, data: [{ id: 'old', url: 'https://example.invalid/old' }] }); });
    expect(result.current.images).toEqual([]);
    expect(auditReportView).toHaveBeenLastCalledWith('organization-2', 'report-b');
    expect(getReportImages).toHaveBeenLastCalledWith('organization-2', 'report-b');
  });

  it('ignores old images after changing the client and report', async () => {
    const images = deferred<{ ok: true; data: { id: string; url: string }[] }>();
    vi.mocked(getReportImages).mockReturnValueOnce(images.promise);
    const { result, rerender } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.imagesLoading).toBe(true));
    testState.clientId = 'client-2';
    testState.search = 'reportId=report-b&draftKey=test-draft';
    rerender();
    expect(result.current.loading).toBe(true);
    await act(async () => { testState.reports.get('report-b')!.resolve(report('report-b', '2026-07-21T12:00:00Z')); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { images.resolve({ ok: true, data: [{ id: 'old-image', url: 'https://example.invalid/old' }] }); });
    expect(result.current.answers.note).toBe('report-b');
    expect(result.current.images).toEqual([]);
  });

  it.each(['pending', 'approved', 'remanded'] as const)('loads %s records without waiting for attachments', async status => {
    vi.mocked(getReportImages).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRecordForm());
    const response = report('report-a', '2026-07-20T12:00:00Z');
    response.data.status = status;
    await act(async () => { testState.reports.get('report-a')!.resolve(response); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentStatus).toBe(status);
    expect(result.current.isReadOnly).toBe(status === 'approved');
  });

  it('does not expose an editable partial record on values failure or a missing report', async () => {
    testState.valuesError = { message: 'failed' };
    const { result, rerender } = renderHook(() => useRecordForm());
    await act(async () => { testState.reports.get('report-a')!.resolve(report('report-a', '2026-07-20T12:00:00Z')); });
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.loading).toBe(true);
    testState.search = 'reportId=report-b&draftKey=test-draft';
    rerender();
    await act(async () => { testState.reports.get('report-b')!.resolve({ data: null, error: null }); });
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.answers).toEqual({});
    expect(result.current.loading).toBe(true);
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
