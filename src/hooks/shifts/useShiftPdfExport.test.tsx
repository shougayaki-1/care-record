// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { useShiftPdfExport } from './useShiftPdfExport';
const mocks = vi.hoisted(() => ({ pdf: vi.fn(), matrix: vi.fn() }));
vi.mock('@/utils/shiftPdfExport', () => ({ downloadShiftPdf: mocks.pdf, downloadShiftMatrixPdf: mocks.matrix }));
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const options = () => {
  const calendarRef = createRef<FullCalendar>();
  const api = { view: { type: 'listMonth' } };
  Object.assign(calendarRef, { current: { getApi: () => api } });
  return { calendarRef, api, currentOrg: { id: 'org', name: '事業所' }, activeTab: 'byClient' as const,
    selectedStaffId: 'staff', selectedClientId: 'client', staffs: [{ id: 'staff', name: 'スタッフ' }],
    clients: [{ id: 'client', name: '利用者' }], rawShifts: [], showToast: vi.fn() };
};
it('passes the active view and filters to displayed PDF and raw rows to matrix PDF', async () => {
  const opts = options(); const { result } = renderHook(() => useShiftPdfExport(opts));
  await act(async () => { await result.current.handleDownloadPdf(); await result.current.handleDownloadMatrixPdf(); });
  expect(mocks.pdf).toHaveBeenCalledWith({ calendarApi: opts.api, currentOrg: opts.currentOrg, activeTab: opts.activeTab,
    staffs: opts.staffs, clients: opts.clients, selectedStaffId: 'staff', selectedClientId: 'client' });
  expect(mocks.matrix).toHaveBeenCalledWith({ calendarApi: opts.api, currentOrg: opts.currentOrg, staffs: opts.staffs, rawShifts: opts.rawShifts });
  expect(result.current.pdfGenerating).toBe(false);
});
it.each(['handleDownloadPdf', 'handleDownloadMatrixPdf'] as const)('keeps busy while %s runs and reports download failures', async method => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, fail) => { reject = fail; });
  (method === 'handleDownloadPdf' ? mocks.pdf : mocks.matrix).mockReturnValueOnce(pending);
  const opts = options(); const { result } = renderHook(() => useShiftPdfExport(opts));
  let running!: Promise<void>;
  act(() => { running = result.current[method](); }); expect(result.current.pdfGenerating).toBe(true);
  await act(async () => { reject(new Error('download failed')); await running; });
  expect(result.current.pdfGenerating).toBe(false); expect(opts.showToast).toHaveBeenCalledWith(expect.stringContaining('失敗'), 'error');
});
it('does not export without a calendar or workspace', async () => {
  const opts = options(); Object.assign(opts.calendarRef, { current: null });
  const { result } = renderHook(() => useShiftPdfExport({ ...opts, currentOrg: null }));
  await act(async () => { await result.current.handleDownloadPdf(); await result.current.handleDownloadMatrixPdf(); });
  expect(mocks.pdf).not.toHaveBeenCalled(); expect(mocks.matrix).not.toHaveBeenCalled();
});
