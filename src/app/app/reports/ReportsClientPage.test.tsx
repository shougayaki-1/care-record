// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_PERMISSIONS } from '@/utils/permissions';

const state = vi.hoisted(() => ({
  from: vi.fn(), toast: vi.fn(), confirm: vi.fn(), audit: vi.fn(), gas: vi.fn(),
  zip: vi.fn(), pdf: vi.fn(), download: vi.fn(), shift: true,
  missing: '' as string, missingClient: false, failure: '' as string, templates: true, linked: true,
  calls: [] as string[],
}));
const reports = ['A', 'B', 'C'].map((id) => ({
  id, start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-01T01:00:00Z',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  status: 'approved', approved_at: null, clients: { id: `client-${id}`, name: `Client ${id}`, organization_id: 'org' },
  helper: { name: 'Helper' }, report_values: { helpers: [] },
  segment_id: id, segment: { service_type: { name: `Service ${id}` } },
}));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: { id: 'org', effectivePermissions: FULL_PERMISSIONS }, userId: 'user', loading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: state.toast }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/app/actions/reports', () => ({ auditReportExport: state.audit, softDeleteReports: vi.fn(), transitionReports: vi.fn() }));
vi.mock('@/app/actions/gas', () => ({ callGasApi: state.gas }));
vi.mock('@/app/actions/clients', () => ({ updateClientGoogleLink: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: state.from } }));
vi.mock('@/hooks/useRecordQuery', () => ({ useRecordQuery: ({ queryKey }: { queryKey: string }) => ({
  data: queryKey.startsWith('report-clients') ? reports.map((r) => r.clients) : { reports, aiSentCount: 0 },
  loading: false, error: null, refresh: vi.fn(),
}) }));
vi.mock('@/hooks/useReportFilters', () => ({ useReportFilters: () => ({
  filterClientId: 'all', filterStatus: 'all', startDate: '', endDate: '', onlyPending: false,
  filterShiftId: state.shift ? 'shift' : null, order: 'asc', orderBy: 'start_at', ready: true, isExportView: true,
  setFilterClientId: vi.fn(), setFilterStatus: vi.fn(), setStartDate: vi.fn(), setEndDate: vi.fn(),
  setOnlyPending: vi.fn(), setOrder: vi.fn(), setOrderBy: vi.fn(), resetFilters: vi.fn(),
}) }));
vi.mock('@/utils/reportZipExport', async (original) => ({
  ...await original<typeof import('@/utils/reportZipExport')>(), downloadReportZip: state.zip,
}));
vi.mock('@react-pdf/renderer', () => ({ pdf: state.pdf }));
vi.mock('@/components/pdf/ServiceRecordDocument', () => ({ ServiceRecordDocument: () => null }));
vi.mock('@/components/record/RecordListFilterBar', () => ({ RecordListFilterBar: () => null }));
vi.mock('@/components/record/RecordListTable', () => ({ RecordListTable: ({ onToggle }: { onToggle: (id: string) => void }) => <button onClick={() => onToggle('B')}>select B</button> }));
import ReportsClientPage from './ReportsClientPage';

beforeEach(() => {
  vi.clearAllMocks(); state.missing = ''; state.missingClient = false; state.failure = ''; state.templates = true; state.linked = true; state.shift = true; state.calls = [];
  state.confirm.mockResolvedValue(true);
  state.audit.mockImplementation(async () => { state.calls.push('audit'); return { ok: true, data: undefined }; });
  state.gas.mockImplementation(async () => { state.calls.push('gas'); return { ok: true, data: { folderId: 'folder' } }; });
  state.zip.mockImplementation(async () => { state.calls.push('zip'); });
  state.pdf.mockImplementation(() => { state.calls.push('pdf'); return { toBlob: async () => new Blob() }; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(state.download);
  vi.stubGlobal('open', vi.fn());
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  state.from.mockImplementation((table: string) => {
    state.calls.push(table);
    const data = table === 'report_values' ? reports.filter((r) => r.id !== state.missing).map((r) => ({ report_id: r.id, data: { note: `Body ${r.id}`, travel_expenses: [{ staff_name: 'Staff', amount_yen: 100, method: 'car' }] } }))
      : table === 'form_templates' ? state.templates ? reports.map((r) => ({ client_id: r.clients.id, schema: [{ id: 'note', label: 'Note', type: 'text' }] })) : []
      : table === 'clients' ? reports.filter((r) => !state.missingClient || r.id !== 'B').map((r) => ({ ...r.clients, google_template_id: state.templates ? 'template' : null, google_folder_id: 'folder' }))
      : { google_folder_id: state.linked ? 'folder' : null };
    const result = { data, error: state.failure === table ? { message: 'private database failure' } : null };
    const chain = { select: () => chain, in: async () => result, eq: () => chain,
      single: async () => result,
      maybeSingle: async () => ({ ...result, data: Array.isArray(data) ? data[0] ?? null : data }),
    };
    return chain;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const formats = ['CSV', '交通費精算CSV', 'PDF', '全件帳票作成'];
const clickExport = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const expectNoOutput = () => {
  expect(state.download).not.toHaveBeenCalled(); expect(state.zip).not.toHaveBeenCalled();
  expect(state.pdf).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled();
};

describe('report export handlers', () => {
  it.each(formats.flatMap((format) => ['A', 'B', 'C'].map((missing) => [format, missing])))('%s stops the entire export when %s has no body', async (format, missing) => {
    state.missing = missing; render(<ReportsClientPage />); clickExport(format);
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput();
  });

  it.each(['CSV', 'PDF', '全件帳票作成'])('%s stops on template fetch failure', async (format) => {
    state.failure = 'form_templates'; render(<ReportsClientPage />); clickExport(format);
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput(); expect(JSON.stringify(state.toast.mock.calls)).not.toContain('private');
  });

  it.each(['clients', 'organizations'])('GAS stops before any external call on %s failure', async (table) => {
    state.failure = table; render(<ReportsClientPage />); clickExport('全件帳票作成');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput();
  });

  it('rejects incomplete client results instead of silently skipping a selected client', async () => {
    state.missingClient = true; render(<ReportsClientPage />); clickExport('全件帳票作成');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput();
  });

  it.each(formats)('%s stops on body fetch failure and can retry', async (format) => {
    state.failure = 'report_values'; render(<ReportsClientPage />); clickExport(format);
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput(); state.failure = ''; clickExport(format);
    await waitFor(() => expect(state.download.mock.calls.length + state.zip.mock.calls.length + state.gas.mock.calls.length).toBeGreaterThan(0));
  });

  it.each(['A', 'B', 'C'])('combined PDF also stops when %s has no body', async (missing) => {
    state.shift = false; state.missing = missing; render(<ReportsClientPage />); clickExport('PDF');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput();
  });

  it.each(formats)('%s stops when the pre-export audit fails', async (format) => {
    state.audit.mockResolvedValue({ ok: false, error: { code: 'INTERNAL_ERROR', message: '出力に失敗しました' } });
    render(<ReportsClientPage />); clickExport(format);
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput();
  });

  it('keeps ZIP body, identity, and naming metadata together for all records', async () => {
    render(<ReportsClientPage />); clickExport('PDF');
    await waitFor(() => expect(state.zip).toHaveBeenCalledOnce());
    const entries = state.zip.mock.calls[0][0];
    expect(entries).toHaveLength(3);
    entries.forEach((entry: { data: { id: string; data: { note: string } }; fileName: string }, i: number) => {
      const id = reports[i].id;
      expect(entry.data.id).toBe(id); expect(entry.data.data.note).toBe(`Body ${id}`);
      expect(entry.fileName).toContain(`Client ${id}_Service ${id}_`);
    });
    expect(state.calls.indexOf('audit')).toBeLessThan(state.calls.indexOf('zip'));
  });

  it('preserves selection after failure and refetches the body on retry', async () => {
    state.missing = 'B'; render(<ReportsClientPage />); fireEvent.click(screen.getByText('select B')); clickExport('PDF');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expectNoOutput(); expect(screen.getByText('1 件選択中')).toBeTruthy();
    state.missing = ''; clickExport('PDF');
    await waitFor(() => expect(state.zip).toHaveBeenCalledOnce());
    expect(state.zip.mock.calls[0][0]).toHaveLength(1);
    expect(state.zip.mock.calls[0][0][0].data.id).toBe('B');
    expect(state.from.mock.calls.filter(([table]) => table === 'report_values')).toHaveLength(2);
  });

  it.each(['CSV', 'PDF'])('%s permits a successfully fetched but unset form template', async (format) => {
    state.templates = false; state.shift = false; render(<ReportsClientPage />); clickExport(format);
    await waitFor(() => expect(state.download).toHaveBeenCalledOnce());
    expect(state.toast).not.toHaveBeenCalled();
    if (format === 'PDF') expect(state.pdf.mock.calls[0][0].props.reports).toHaveLength(3);
  });

  it('keeps the existing GAS skip behavior for unset Google templates', async () => {
    state.templates = false; render(<ReportsClientPage />); clickExport('全件帳票作成');
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(state.gas).not.toHaveBeenCalled();
  });

  it('keeps the existing warning for a successfully fetched unlinked organization', async () => {
    state.linked = false; render(<ReportsClientPage />); clickExport('全件帳票作成');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('連携が設定されていません'), 'warning'));
    expectNoOutput();
  });

  it('prepares all bodies and audits before GAS folder or PDF calls', async () => {
    render(<ReportsClientPage />); clickExport('全件帳票作成');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('作成が完了')));
    expect(state.calls.indexOf('report_values')).toBeLessThan(state.calls.indexOf('gas'));
    expect(state.calls.indexOf('audit')).toBeLessThan(state.calls.indexOf('gas'));
    const pdfCalls = state.gas.mock.calls.map(([payload]) => payload).filter((payload) => payload.action === 'create_pdf');
    expect(pdfCalls.map((payload) => [payload.reportId, payload.data.Note])).toEqual([['A', 'Body A'], ['B', 'Body B'], ['C', 'Body C']]);
  });
});
