// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';
import type { ShiftFormModal } from '@/components/shifts/ShiftFormModal';

const state = vi.hoisted(() => ({
  calendar: null as ComponentProps<typeof ShiftCalendarViewer> | null,
  form: null as ComponentProps<typeof ShiftFormModal> | null,
  toast: vi.fn(), fetch: vi.fn(), fetchMaster: vi.fn(), progress: vi.fn(),
  time: vi.fn(), cancel: vi.fn(), remove: vi.fn(), update: vi.fn(),
  revert: vi.fn(),
}));
vi.mock('next/dynamic', () => ({
  default: (loader: () => unknown) => {
    if (String(loader).includes('ShiftCalendarViewer')) return (props: ComponentProps<typeof ShiftCalendarViewer>) => { state.calendar = props; return null; };
    if (String(loader).includes('ShiftFormModal')) return (props: ComponentProps<typeof ShiftFormModal>) => { state.form = props; return null; };
    return () => null;
  },
}));
vi.mock('next/navigation', () => {
  const router = { push: vi.fn(), replace: vi.fn() };
  const params = new URLSearchParams();
  return { useRouter: () => router, useSearchParams: () => params };
});
vi.mock('@/context/WorkspaceContext', () => {
  const currentOrg = { id: 'org-1', effectivePermissions: { shifts: { view: 'all', edit: 'all', create: 'all', delete: 'all' }, management: {} } };
  return { useWorkspace: () => ({ currentOrg, userId: 'user-1', loading: false }) };
});
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: state.toast }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/utils/shiftPdfExport', () => ({ downloadShiftPdf: vi.fn(), downloadShiftMatrixPdf: vi.fn() }));
vi.mock('@/app/actions/shift', () => ({
  updateShift: state.update, updateShiftTimeOnly: state.time,
  toggleCancelShift: state.cancel, deleteShift: state.remove,
  createShift: vi.fn(), createShiftPattern: vi.fn(), deleteShiftPattern: vi.fn(), updateShiftPattern: vi.fn(),
  generateShiftsForMonth: vi.fn(), previewShiftsForMonth: vi.fn(), deleteShiftsBatch: vi.fn(),
}));
vi.mock('@/hooks/useShiftData', () => ({
  useShiftData: () => ({
    rawShifts: [], patterns: [], events: [], clients: [], staffs: [], currentStaffId: null,
    initialLoading: false, isFetching: false, unsyncedCount: 0, setUnsyncedCount: vi.fn(),
    fetchData: state.fetch, fetchMasterData: state.fetchMaster,
  }),
}));
vi.mock('@/hooks/useSyncProgress', () => ({
  useSyncProgress: () => ({
    syncProgress: null, setSyncProgress: state.progress,
    repairingFromBanner: false, resyncingCal: false, runUnsyncedSyncLoop: vi.fn(),
    handleRepairFromBanner: vi.fn(), handleForceResyncCalendar: vi.fn(),
  }),
}));

import ShiftManagePage from './page';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const action of [state.time, state.cancel, state.remove, state.update]) action.mockResolvedValue({ success: true });
  state.remove.mockResolvedValue({ success: true, deleted: 1, failed: 0 });
  await act(async () => { render(<ShiftManagePage />); });
  state.fetch.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cases = [
  { name: 'drag', action: state.time, run: () => state.calendar!.onEventDrop!({ event: { extendedProps: { shiftId: 'shift-1' }, start: new Date('2026-01-01T09:00:00Z'), end: new Date('2026-01-01T10:00:00Z') }, revert: state.revert } as never), success: 'シフト時間を調整しました' },
  { name: 'resize', action: state.time, run: () => state.calendar!.onEventResize!({ event: { extendedProps: { shiftId: 'shift-1' }, start: new Date('2026-01-01T09:00:00Z'), end: new Date('2026-01-01T10:00:00Z') }, revert: state.revert } as never), success: 'シフト時間を調整しました' },
  { name: 'cancel', action: state.cancel, run: () => state.form!.onToggleCancel!('shift-1', true, ''), success: 'シフトをお休みに設定しました' },
  { name: 'reopen', action: state.cancel, run: () => state.form!.onToggleCancel!('shift-1', false, ''), success: '通常予定に復元しました' },
  { name: 'delete', action: state.remove, run: () => state.form!.onDelete!('shift-1'), success: 'シフトを削除しました' },
  { name: 'save', action: state.update, run: () => state.form!.onSave({ organizationId: 'org-1', clientId: 'client-1', title: 'test', startAt: 'start', endAt: 'end' }, 'shift-1'), success: 'シフト情報を保存しました' },
];
describe.each(cases)('$name mutation UI', ({ name, action, run, success }) => {
  it('avoids success UI and reverts calendar changes when the action rejects', async () => {
    action.mockRejectedValue(new Error('シフトを更新できませんでした'));
    await act(async () => {
      if (name === 'delete') await expect(run()).rejects.toThrow();
      else await run();
    });
    if (name === 'delete') {
      expect(state.toast).not.toHaveBeenCalled(); // The modal displays the propagated error.
    } else {
      expect(state.toast).toHaveBeenCalledTimes(1);
      expect(state.toast).toHaveBeenCalledWith(expect.any(String), 'error');
    }
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.revert).toHaveBeenCalledTimes(['drag', 'resize'].includes(name) ? 1 : 0);
    expect(state.progress).toHaveBeenLastCalledWith(null);
  });
  it('preserves success toast and refresh after a confirmed mutation', async () => {
    await act(async () => { await run(); });
    if (name === 'delete') expect(state.toast).toHaveBeenCalledWith(success, 'success');
    else expect(state.toast).toHaveBeenCalledWith(success);
    expect(state.fetch).toHaveBeenCalledWith(true);
    expect(state.revert).not.toHaveBeenCalled();
    expect(state.progress).toHaveBeenLastCalledWith(null);
  });
});

it('refreshes a deleted shift and warns instead of claiming Google deletion completed', async () => {
  state.remove.mockResolvedValue({ success: true, deleted: 1, failed: 1 });
  await act(async () => { await state.form!.onDelete!('shift-1'); });
  expect(state.toast).toHaveBeenCalledWith('シフトを削除しました。Googleカレンダーへの反映に失敗しました。連携を確認して同期修復を実行してください。', 'warning');
  expect(state.toast).not.toHaveBeenCalledWith('シフトを削除しました', 'success');
  expect(state.fetch).toHaveBeenCalledWith(true);
  expect(state.progress).toHaveBeenLastCalledWith(null);
});
