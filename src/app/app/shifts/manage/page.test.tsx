// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';
import type { ShiftFormModal } from '@/components/shifts/ShiftFormModal';
import type { ShiftListItem } from '@/features/shifts/types';
import type { useShiftData } from '@/hooks/useShiftData';

const state = vi.hoisted(() => ({
  masterStatus: 'success' as 'loading' | 'success' | 'error',
  countStatus: 'success' as 'loading' | 'success' | 'error',
  count: 0 as number | null,
  fetchCount: vi.fn(),
  params: new URLSearchParams(), gotoDate: vi.fn(), push: vi.fn(), replace: vi.fn(),
  rows: [] as ShiftListItem[],
  view: 'all', create: 'all', edit: 'all', delete: 'all',
  dataOptions: null as Parameters<typeof useShiftData>[0] | null,
  pdf: vi.fn(), matrix: vi.fn(),
  calendar: null as ComponentProps<typeof ShiftCalendarViewer> | null,
  form: null as ComponentProps<typeof ShiftFormModal> | null,
  toast: vi.fn(), fetch: vi.fn(), fetchMaster: vi.fn(), progress: vi.fn(),
  time: vi.fn(), cancel: vi.fn(), remove: vi.fn(), update: vi.fn(),
  revert: vi.fn(),
}));
vi.mock('next/dynamic', () => ({
  default: (loader: () => unknown) => {
    if (String(loader).includes('ShiftCalendarViewer')) return (props: ComponentProps<typeof ShiftCalendarViewer>) => { state.calendar = props;
      if (props.calendarRef) Object.assign(props.calendarRef, { current: { getApi: () => ({ gotoDate: state.gotoDate }) } });
      return null; };
    if (String(loader).includes('ShiftFormModal')) return (props: ComponentProps<typeof ShiftFormModal>) => { state.form = props; return null; };
    return () => null;
  },
}));
vi.mock('next/navigation', () => {
  const router = { push: state.push, replace: state.replace };
  return { useRouter: () => router, useSearchParams: () => state.params };
});
vi.mock('@/context/WorkspaceContext', () => {
  const currentOrg = { id: 'org-1', effectivePermissions: { shifts: { get view() { return state.view; }, get edit() { return state.edit; }, get create() { return state.create; }, get delete() { return state.delete; } }, management: {} } };
  return { useWorkspace: () => ({ currentOrg, userId: 'user-1', loading: false }) };
});
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: state.toast }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/utils/shiftPdfExport', () => ({ downloadShiftPdf: state.pdf, downloadShiftMatrixPdf: state.matrix }));
vi.mock('@/app/actions/shift', () => ({
  updateShift: state.update, updateShiftTimeOnly: state.time,
  toggleCancelShift: state.cancel, deleteShift: state.remove,
  createShift: vi.fn(), createShiftPattern: vi.fn(), deleteShiftPattern: vi.fn(), updateShiftPattern: vi.fn(),
  generateShiftsForMonth: vi.fn(), previewShiftsForMonth: vi.fn(), deleteShiftsBatch: vi.fn(),
}));
vi.mock('@/hooks/useShiftData', () => ({
  useShiftData: (options: Parameters<typeof useShiftData>[0]) => { state.dataOptions = options; return ({
    rawShifts: state.rows, patterns: [], events: [], clients: [], staffs: [], currentStaffId: null,
    initialLoading: false, isFetching: false, unsyncedCount: state.count, masterDataStatus: state.masterStatus, unsyncedCountStatus: state.countStatus, fetchUnsyncedCount: state.fetchCount, setUnsyncedCount: vi.fn(),
    fetchData: state.fetch, fetchMasterData: state.fetchMaster,
  }); },
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
  state.params = new URLSearchParams(); state.rows = [];
  state.view = 'all'; state.create = 'all'; state.edit = 'all'; state.delete = 'all';
  state.masterStatus = 'success'; state.countStatus = 'success'; state.count = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const action of [state.time, state.cancel, state.remove, state.update]) action.mockResolvedValue({ ok: true, data: { success: true } });
  state.remove.mockResolvedValue({ ok: true, data: { success: true, deleted: 1, failed: 0 } });
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
  it('avoids success UI and preserves modal rejection or reverts calendar changes for a failed result', async () => {
    action.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'シフトを更新できませんでした' } });
    await act(async () => {
      if (['delete', 'save', 'cancel', 'reopen'].includes(name)) await expect(run()).rejects.toThrow();
      else await run();
    });
    if (['delete', 'save', 'cancel', 'reopen'].includes(name)) {
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
  state.remove.mockResolvedValue({ ok: true, data: { success: true, deleted: 1, failed: 1 } });
  await act(async () => { await state.form!.onDelete!('shift-1'); });
  expect(state.toast).toHaveBeenCalledWith('シフトを削除しました。Googleカレンダーへの反映に失敗しました。連携を確認して同期修復を実行してください。', 'warning');
  expect(state.toast).not.toHaveBeenCalledWith('シフトを削除しました', 'success');
  expect(state.fetch).toHaveBeenCalledWith(true);
  expect(state.progress).toHaveBeenLastCalledWith(null);
});

it.each(['loading', 'error'] as const)('blocks master-dependent creation and editing during %s while keeping browsing', async status => {
  state.masterStatus = status;
  cleanup();
  const view = render(<ShiftManagePage />);
  await act(async () => {});
  expect((screen.getByRole('button', { name: '単発シフトを追加' }) as HTMLButtonElement).disabled).toBe(true);
  expect(state.calendar!.editable).toBe(false);
  expect(state.calendar!.selectable).toBe(false);
  expect(state.form!.canSave).toBe(false);
  expect(state.calendar!.onEventClick).toBeDefined();
  await act(async () => {
    await expect(state.form!.onSave({ organizationId: 'org-1', clientId: 'client', title: 'title', startAt: 'start', endAt: 'end' })).rejects.toThrow('再取得');
  });
  expect(state.update).not.toHaveBeenCalled();
  if (status === 'error') {
    state.fetchMaster.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'マスタを再試行' }));
    expect(state.fetchMaster).toHaveBeenCalledTimes(1);
  }
  state.masterStatus = 'success';
  await act(async () => { view.rerender(<ShiftManagePage />); });
  expect((screen.getByRole('button', { name: '単発シフトを追加' }) as HTMLButtonElement).disabled).toBe(false);
  expect(state.calendar!.editable).toBe(true);
  expect(state.form!.canSave).toBe(true);
  expect(screen.queryByText(/新規作成・編集は再取得後/)).toBeNull();
});

it('shows count failure and retry without presenting a previous count as current', async () => {
  state.countStatus = 'error'; state.count = 7;
  cleanup();
  const view = render(<ShiftManagePage />);
  await act(async () => {});
  expect(screen.getByText(/同期状態は未確認/)).toBeDefined();
  expect(screen.queryByText(/Googleカレンダーと同期されていない予定が/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '未同期件数を再試行' }));
  expect(state.fetchCount).toHaveBeenCalledTimes(1);
  state.countStatus = 'success'; state.count = 0;
  await act(async () => { view.rerender(<ShiftManagePage />); });
  expect(screen.queryByText(/同期状態は未確認/)).toBeNull();
});

const shift: ShiftListItem = { id: 'shift-deep', organization_id: 'org-1', client_id: 'client-1', title: '訪問',
  start_at: '2026-12-05T09:00:00+09:00', end_at: '2026-12-05T10:00:00+09:00', status: 'published',
  cancel_reason: null, clients: { id: 'client-1', name: '利用者' }, shift_staffs: [], report_statuses: [] };

it('navigates the start deep link, opens shiftId when fetched and handles it only once', async () => {
  cleanup(); state.params = new URLSearchParams('shiftId=shift-deep&start=2026-12-05&month=2026-12');
  const view = render(<ShiftManagePage />); await act(async () => {});
  expect(state.gotoDate).toHaveBeenCalledWith(new Date('2026-12-05'));
  expect(state.form!.open).toBe(false);
  state.rows = [shift];
  await act(async () => { view.rerender(<ShiftManagePage />); });
  expect(state.form!.open).toBe(true); expect(state.form!.initialData).toEqual(shift);
  act(() => state.form!.onClose());
  await act(async () => { view.rerender(<ShiftManagePage />); });
  expect(state.form!.open).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: '基本パターン(ひな形)' })); await act(async () => {});
  expect(screen.getByDisplayValue('2026-12')).toBeDefined();
});
it('preserves calendar month range fetching and resets initialization after the pattern tab', async () => {
  const range = { start: new Date('2026-12-01'), end: new Date('2027-01-01') };
  await act(async () => { state.calendar!.onDatesSet!(range as never); });
  expect(state.fetch).not.toHaveBeenCalled();
  await act(async () => { state.calendar!.onDatesSet!(range as never); });
  expect(state.fetch).toHaveBeenLastCalledWith(true, range);
  fireEvent.click(screen.getByRole('tab', { name: '基本パターン(ひな形)' })); await act(async () => {});
  fireEvent.click(screen.getByRole('tab', { name: '全体カレンダー' })); await act(async () => {});
  state.fetch.mockClear();
  await act(async () => { state.calendar!.onDatesSet!(range as never); }); expect(state.fetch).not.toHaveBeenCalled();
});
it('connects staff and client filter selections to fetching and preserves PDF action visibility', async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'スタッフ別' })); await act(async () => {});
  expect(state.dataOptions!.activeTab).toBe('byStaff');
  expect(screen.getByRole('combobox', { name: 'スタッフを選択' })).toBeDefined();
  expect(screen.getByRole('button', { name: '全体マトリックスPDF' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '全体マトリックスPDF' })); await act(async () => {});
  expect(state.matrix).toHaveBeenCalledWith(expect.objectContaining({ rawShifts: state.rows }));
  fireEvent.click(screen.getByRole('tab', { name: '利用者別' })); await act(async () => {});
  expect(state.dataOptions!.activeTab).toBe('byClient');
  expect(screen.getByRole('combobox', { name: '利用者を選択' })).toBeDefined();
  expect(screen.queryByRole('button', { name: '全体マトリックスPDF' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '表示中の形式でPDF出力' })); await act(async () => {});
  expect(state.pdf).toHaveBeenCalledWith(expect.objectContaining({ activeTab: 'byClient', selectedClientId: 'all' }));
});
it('maintains permission-based edit and delete routes while redirecting restricted viewers', async () => {
  state.view = 'assigned'; state.create = 'none'; state.edit = 'none'; state.delete = 'none';
  cleanup(); render(<ShiftManagePage />); await act(async () => {});
  expect(state.replace).toHaveBeenCalledWith('/app/shifts/my');
  expect(screen.queryByRole('tab', { name: '全体カレンダー' })).toBeNull();
  expect(screen.queryByRole('button', { name: '単発シフトを追加' })).toBeNull();
  expect(state.calendar!.editable).toBe(false); expect(state.calendar!.selectable).toBe(false);
  expect(state.form!.onDelete).toBeUndefined(); expect(state.form!.onToggleCancel).toBeUndefined();
});

it('keeps the open modal after save and delete rejection', async () => {
  act(() => state.calendar!.onEventClick!({ event: { extendedProps: { shiftData: shift } } } as never));
  expect(state.form!.open).toBe(true);
  const failure = { ok: false, error: { code: 'FORBIDDEN', message: '更新できません' } };
  state.update.mockResolvedValue(failure); state.remove.mockResolvedValue(failure);
  await act(async () => {
    await expect(state.form!.onSave({ organizationId: 'org-1', clientId: 'client-1', title: '', startAt: '', endAt: '' }, shift.id)).rejects.toThrow();
  });
  expect(state.form!.open).toBe(true); expect(state.form!.initialData?.id).toBe(shift.id);
  await act(async () => { await expect(state.form!.onDelete!(shift.id)).rejects.toThrow(); });
  expect(state.form!.open).toBe(true); expect(state.form!.initialData?.id).toBe(shift.id);
});
