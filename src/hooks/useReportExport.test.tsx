// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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
vi.mock('@/utils/reportZipExport', async (original) => ({
  ...await original<typeof import('@/utils/reportZipExport')>(), downloadReportZip: state.zip,
}));
vi.mock('@react-pdf/renderer', () => ({ pdf: state.pdf }));
vi.mock('@/components/pdf/ServiceRecordDocument', () => ({ ServiceRecordDocument: () => null }));
import { useReportExport } from './useReportExport';
import type { Report } from '@/utils/reportExportData';

beforeEach(() => {
  vi.clearAllMocks(); state.missing = ''; state.missingClient = false; state.failure = ''; state.templates = true; state.linked = true; state.shift = true; state.calls = [];
  state.confirm.mockImplementation(async () => { state.calls.push('confirm'); return true; });
  state.audit.mockImplementation(async () => { state.calls.push('audit'); return { ok: true, data: undefined }; });
  state.gas.mockImplementation(async () => { state.calls.push('gas'); return { ok: true, data: { folderId: 'folder' } }; });
  state.zip.mockImplementation(async () => { state.calls.push('zip'); });
  state.pdf.mockImplementation(() => { state.calls.push('pdf'); return { toBlob: async () => new Blob() }; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { state.calls.push('download'); state.download(); });
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


const modes = [
  ['CSV', 'handleExportCSV', ['confirm', 'audit', 'form_templates', 'report_values', 'download']],
  ['travel', 'handleExportTravelCosts', ['report_values', 'audit', 'download']],
  ['ZIP', 'handleBulkDownloadPDF', ['confirm', 'audit', 'report_values', 'form_templates', 'zip']],
  ['GAS', 'handleCreateGasPdf', ['clients', 'form_templates', 'organizations', 'confirm', 'report_values', 'audit', 'gas']],
] as const;
const mount = (selected: readonly string[] = []) => renderHook(
  ({ selected }) => useReportExport({ organizationId: 'org', reports: reports as Report[], selected, filterShiftId: 'shift' }),
  { initialProps: { selected } },
);

describe('export controller', () => {
  it.each(modes)('%s preserves confirmation, acquisition, audit and output order', async (_name, handler, expected) => {
    const { result } = mount();
    await act(() => result.current[handler]());
    const positions = expected.map((call) => state.calls.indexOf(call));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(state.audit).toHaveBeenCalledWith('org', ['A', 'B', 'C'], handler === 'handleExportCSV' || handler === 'handleExportTravelCosts' ? 'csv' : 'pdf');
    expect(result.current.exporting).toBe(false);
    expect(result.current.gasProgress).toBeNull();
  });

  it('combined PDF keeps audit and body acquisition before rendering and download', async () => {
    const { result } = renderHook(() => useReportExport({ organizationId: 'org', reports: reports as Report[], selected: ['B'], filterShiftId: null }));
    await act(() => result.current.handleBulkDownloadPDF());
    expect(state.calls).toEqual(['confirm', 'audit', 'report_values', 'form_templates', 'pdf', 'download']);
    expect(state.pdf.mock.calls[0][0].props.reports[0].id).toBe('B');
  });

  it.each(modes)('%s fixes the target before awaiting and blocks other formats until completion', async (_name, handler) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    if (handler === 'handleExportTravelCosts') state.audit.mockImplementation(async () => { await gate; return { ok: true, data: undefined }; });
    else state.confirm.mockImplementation(async () => { await gate; return true; });
    const { result, rerender } = mount(['B']);
    let running!: Promise<void>;
    act(() => { running = result.current[handler](); });
    await waitFor(() => expect(result.current.exporting).toBe(true));
    rerender({ selected: ['C'] });
    await act(async () => {
      await result.current.handleExportCSV();
      await result.current.handleExportTravelCosts();
      await result.current.handleBulkDownloadPDF();
      await result.current.handleCreateGasPdf();
    });
    expect(state.gas).not.toHaveBeenCalled(); expect(state.pdf).not.toHaveBeenCalled(); expect(state.zip).not.toHaveBeenCalled(); expect(state.download).not.toHaveBeenCalled();
    await act(async () => { release(); await running; });
    expect(state.audit).toHaveBeenCalledTimes(1);
    expect(state.audit.mock.calls[0][1]).toEqual(['B']);
    expect(result.current.exporting).toBe(false);
    if (handler === 'handleBulkDownloadPDF') expect(state.zip.mock.calls[0][0][0].data.id).toBe('B');
    if (handler === 'handleCreateGasPdf') expect(state.gas.mock.calls.filter(([p]) => p.action === 'create_pdf').map(([p]) => p.reportId)).toEqual(['B']);
  });

  it.each(['handleExportCSV', 'handleBulkDownloadPDF', 'handleCreateGasPdf'] as const)('%s releases the lock after cancellation', async (handler) => {
    state.confirm.mockResolvedValue(false);
    const { result } = mount(['B']);
    await act(() => result.current[handler]());
    expect(state.audit).not.toHaveBeenCalled(); expect(state.download).not.toHaveBeenCalled();
    expect(result.current.exporting).toBe(false); expect(result.current.gasProgress).toBeNull();
    state.confirm.mockResolvedValue(true);
    await act(() => result.current.handleExportCSV());
    expect(state.download).toHaveBeenCalledOnce();
  });

  it.each(modes)('%s retains selection and releases the lock on audit failure for retry', async (_name, handler) => {
    state.audit.mockResolvedValue({ ok: false, error: { code: 'INTERNAL_ERROR', message: '出力に失敗しました' } });
    const { result } = mount(['B']);
    await act(() => result.current[handler]());
    expect(result.current.exporting).toBe(false); expect(result.current.gasProgress).toBeNull();
    expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(state.download).not.toHaveBeenCalled(); expect(state.gas).not.toHaveBeenCalled();
    state.audit.mockResolvedValue({ ok: true, data: undefined });
    await act(() => result.current[handler]());
    expect(state.audit.mock.calls.map((call) => call[1])).toEqual([['B'], ['B']]);
  });
});
