import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ in: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: db.in }) }) } }));
import { loadReportValues, snapshotExportReports, type Report } from './reportExportData';
const reports: Report[] = Array.from({ length: 51 }, (_, index) => ({
  id: String(index), start_at: '', end_at: '', created_at: '', updated_at: '', approved_at: null,
  status: 'approved', segment_id: null, clients: { id: `client-${index}`, name: `Client ${index}`, organization_id: 'org' },
  helper: { name: 'Helper' }, report_values: null,
}));
beforeEach(() => { db.in.mockReset(); });

describe('export data acquisition', () => {
  it('joins reversed responses across 50-row batches by report ID', async () => {
    db.in.mockImplementation(async (_column: string, ids: string[]) => ({
      data: [...ids].reverse().map((id) => ({ report_id: id, data: { note: `Body ${id}` } })), error: null,
    }));
    const result = await loadReportValues(reports);
    expect(db.in.mock.calls.map((call) => call[1].length)).toEqual([50, 1]);
    expect(result.map((report) => [report.id, report.clients.id, report.report_values])).toEqual(
      reports.map((report) => [report.id, report.clients.id, { data: { note: `Body ${report.id}` } }]),
    );
  });

  it.each(['missing', 'null', 'error'])('rejects the entire export when the last batch is %s', async (failure) => {
    db.in.mockImplementation(async (_column: string, ids: string[]) => ({
      data: ids[0] === '50' && failure === 'missing' ? [] : ids.map((id) => ({ report_id: id, data: id === '50' && failure === 'null' ? null : {} })),
      error: ids[0] === '50' && failure === 'error' ? new Error('database error') : null,
    }));
    await expect(loadReportValues(reports)).rejects.toThrow();
  });

  it('copies selected records and nested naming metadata without changing list state', () => {
    const list = structuredClone(reports);
    const selected = ['1'];
    const snapshot = snapshotExportReports(list, selected);
    selected[0] = '2'; list[1].clients.name = 'Changed';
    expect(snapshot.map((report) => [report.id, report.clients.name])).toEqual([['1', 'Client 1']]);
    expect(snapshotExportReports(reports, [])).toEqual(reports);
    expect(snapshotExportReports(reports, ['unavailable'])).toEqual([]);
  });
});
