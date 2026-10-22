// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReportFilters } from './useReportFilters';

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}));

const options = { userId: 'user-a', organizationId: 'org-a', clients: [{ id: 'client-a' }] };
const key = 'care-record-report-filters:v1:user-a:org-a:list';

describe('useReportFilters', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  beforeEach(() => {
    window.localStorage.clear();
    navigation.params = new URLSearchParams();
    navigation.replace.mockClear();
  });

  it('shows all dates by default for the unapproved and pending views', () => {
    navigation.params = new URLSearchParams('status=unapproved');
    const unapproved = renderHook(() => useReportFilters(options));
    expect(unapproved.result.current.startDate).toBe('');
    expect(unapproved.result.current.endDate).toBe('');
    expect(unapproved.result.current.onlyPending).toBe(true);
    unapproved.unmount();

    navigation.params = new URLSearchParams('recordStatus=pending');
    const pending = renderHook(() => useReportFilters(options));
    expect(pending.result.current.startDate).toBe('');
    expect(pending.result.current.endDate).toBe('');
    pending.unmount();
  });

  it('keeps explicitly requested dates in the unapproved view', () => {
    navigation.params = new URLSearchParams('status=unapproved&from=2026-01-01&to=2026-02-01');
    const { result } = renderHook(() => useReportFilters(options));
    expect(result.current.startDate).toBe('2026-01-01');
    expect(result.current.endDate).toBe('2026-02-01');
  });

  it('clears the ordinary default month when switching to pending', () => {
    const { result } = renderHook(() => useReportFilters(options));
    expect(result.current.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    act(() => result.current.setOnlyPending(true));
    expect(result.current.startDate).toBe('');
  });

  it('keeps an explicit current-month shortcut even for pending records', () => {
    navigation.params = new URLSearchParams('status=unapproved&period=current_month');
    const { result } = renderHook(() => useReportFilters(options));
    expect(result.current.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(result.current.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});


describe('saved report filters', () => {
  beforeEach(() => {
    localStorage.clear();
    navigation.params = new URLSearchParams();
    navigation.replace.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  function saveFilters() {
    const hook = renderHook(() => useReportFilters(options));
    act(() => {
      hook.result.current.setFilterClientId('client-a');
      hook.result.current.setStartDate('');
      hook.result.current.setEndDate('2026-10-20');
      hook.result.current.setFilterStatus('approved');
      hook.result.current.setOrder('asc');
      hook.result.current.setOrderBy('client_name');
    });
    hook.unmount();
  }

  it('restores client, empty dates, status and sort on a fresh mount without a URL', () => {
    saveFilters();
    const { result } = renderHook(() => useReportFilters(options));
    expect(result.current).toMatchObject({ ready: true, filterClientId: 'client-a', startDate: '', endDate: '2026-10-20', filterStatus: 'approved', order: 'asc', orderBy: 'client_name' });
    expect(Object.keys(JSON.parse(localStorage.getItem(key)!)).sort()).toEqual(['version', 'filterClientId', 'filterStatus', 'startDate', 'endDate', 'onlyPending', 'order', 'orderBy', 'isCurrentMonth'].sort());
  });


  it('does not overwrite stored conditions during StrictMode initialization', () => {
    saveFilters();
    const { result } = renderHook(() => useReportFilters(options), { wrapper: StrictMode });
    act(() => vi.runOnlyPendingTimers());
    expect(result.current.filterClientId).toBe('client-a');
    expect(JSON.parse(localStorage.getItem(key)!).filterClientId).toBe('client-a');
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid dates and old versions in otherwise complete saved data', () => {
    saveFilters();
    const saved = JSON.parse(localStorage.getItem(key)!);
    for (const patch of [{ startDate: '2026-02-30' }, { version: 0 }]) {
      localStorage.setItem(key, JSON.stringify({ ...saved, ...patch }));
      const hook = renderHook(() => useReportFilters(options));
      expect(hook.result.current.filterClientId).toBe('all');
      hook.unmount();
    }
  });

  it('keeps explicit dates when turning on pending-only and restores the switch', () => {
    const hook = renderHook(() => useReportFilters(options));
    act(() => {
      hook.result.current.setStartDate('2026-01-01');
      hook.result.current.setEndDate('2026-10-20');
    });
    act(() => hook.result.current.setOnlyPending(true));
    expect(hook.result.current.startDate).toBe('2026-01-01');
    hook.unmount();
    const restored = renderHook(() => useReportFilters(options));
    expect(restored.result.current).toMatchObject({ onlyPending: true, startDate: '2026-01-01', endDate: '2026-10-20' });
  });

  it('continues updating the URL if storage writes exceed quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const hook = renderHook(() => useReportFilters(options));
    act(() => hook.result.current.setEndDate('2026-10-20'));
    act(() => vi.runOnlyPendingTimers());
    expect(navigation.replace.mock.calls.at(-1)![0]).toContain('to=2026-10-20');
  });

  it('prioritizes explicit URL values including empty dates and false switches', () => {
    saveFilters();
    navigation.params = new URLSearchParams('clientId=all&recordStatus=pending&from=&to=&status=all&order=desc&orderBy=start_at');
    const { result } = renderHook(() => useReportFilters(options));
    expect(result.current).toMatchObject({ filterClientId: 'all', filterStatus: 'pending', startDate: '', endDate: '', onlyPending: false, order: 'desc', orderBy: 'start_at' });
  });

  it('pending and current-month shortcuts override conflicting saved modes', () => {
    saveFilters();
    navigation.params = new URLSearchParams('status=unapproved');
    const hook = renderHook(() => useReportFilters(options));
    expect(hook.result.current).toMatchObject({ filterStatus: 'all', onlyPending: true });
    navigation.params = new URLSearchParams('period=current_month');
    hook.rerender();
    expect(hook.result.current.onlyPending).toBe(false);
    expect(hook.result.current.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(hook.result.current.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('recomputes the current month in Japan and lets edited dates leave the shortcut', () => {
    vi.setSystemTime(new Date('2026-10-31T15:30:00Z'));
    navigation.params = new URLSearchParams('period=current_month');
    const hook = renderHook(() => useReportFilters(options));
    expect(hook.result.current).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-30' });
    hook.unmount();
    vi.setSystemTime(new Date('2026-12-10T00:00:00Z'));
    navigation.params = new URLSearchParams();
    const restored = renderHook(() => useReportFilters(options));
    expect(restored.result.current).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-31' });
    act(() => restored.result.current.setStartDate('2026-12-02'));
    expect(restored.result.current.isCurrentMonth).toBe(false);
  });

  it('keeps export preferences independent and never inherits the pending switch', () => {
    saveFilters();
    navigation.params = new URLSearchParams('view=export');
    const hook = renderHook(() => useReportFilters(options));
    expect(hook.result.current).toMatchObject({ filterClientId: 'all', filterStatus: 'approved', onlyPending: false });
    act(() => hook.result.current.setEndDate('2026-09-30'));
    hook.unmount();
    navigation.params = new URLSearchParams();
    const list = renderHook(() => useReportFilters(options));
    expect(list.result.current.endDate).toBe('2026-10-20');
  });

  it('isolates account/organization changes, ignoring the previous scope URL', () => {
    saveFilters();
    const hook = renderHook((props) => useReportFilters(props), { initialProps: options });
    act(() => vi.runOnlyPendingTimers());
    const url = navigation.replace.mock.calls.at(-1)![0] as string;
    navigation.params = new URLSearchParams(url.split('?')[1]);
    hook.rerender(options);
    hook.rerender({ ...options, organizationId: 'org-b' });
    expect(hook.result.current).toMatchObject({ filterClientId: 'all', endDate: '', order: 'desc' });
    hook.rerender({ ...options, userId: 'user-b' });
    expect(hook.result.current.filterClientId).toBe('all');
    hook.rerender(options);
    expect(hook.result.current).toMatchObject({ filterClientId: 'client-a', endDate: '2026-10-20' });
  });

  it('waits for scope and client validation before writing or searching', () => {
    saveFilters();
    const saved = localStorage.getItem(key);
    const hook = renderHook((props: Parameters<typeof useReportFilters>[0]) => useReportFilters(props), { initialProps: { userId: null } as Parameters<typeof useReportFilters>[0] });
    expect(hook.result.current.ready).toBe(false);
    hook.rerender({ userId: options.userId, organizationId: options.organizationId });
    expect(hook.result.current.ready).toBe(false);
    expect(localStorage.getItem(key)).toBe(saved);
    hook.rerender(options);
    expect(hook.result.current.filterClientId).toBe('client-a');
  });

  it.each(['{broken', '{"version":0}', '{"version":1,"startDate":"2026-99-99"}'])('falls back from invalid preferences: %s', (saved) => {
    localStorage.setItem(key, saved);
    const { result } = renderHook(() => useReportFilters(options));
    expect(result.current).toMatchObject({ ready: true, filterClientId: 'all', filterStatus: 'all', order: 'desc' });
  });

  it('drops a missing client and never persists a temporary shift filter', () => {
    saveFilters();
    navigation.params = new URLSearchParams('shiftId=shift-a&clientId=deleted-client');
    const hook = renderHook(() => useReportFilters(options));
    expect(hook.result.current).toMatchObject({ filterClientId: 'all', filterShiftId: 'shift-a' });
    hook.unmount();
    navigation.params = new URLSearchParams();
    const restored = renderHook(() => useReportFilters(options));
    expect(restored.result.current.filterShiftId).toBeNull();
  });

  it('works when localStorage reads/writes throw and resets persistent filters', () => {
    saveFilters();
    const hook = renderHook(() => useReportFilters(options));
    act(() => hook.result.current.resetFilters());
    expect(hook.result.current).toMatchObject({ filterClientId: 'all', filterShiftId: null, filterStatus: 'all', onlyPending: false, endDate: '', order: 'desc' });
    hook.unmount();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    const blocked = renderHook(() => useReportFilters(options));
    act(() => blocked.result.current.setStartDate('2026-01-01'));
    expect(blocked.result.current.startDate).toBe('2026-01-01');
  });

  it('acknowledges its own URL without losing edits and follows Back/Forward URL values', () => {
    const hook = renderHook(() => useReportFilters(options));
    act(() => hook.result.current.setStartDate('2026-01-01'));
    act(() => vi.runOnlyPendingTimers());
    const url = navigation.replace.mock.calls.at(-1)![0] as string;
    navigation.replace.mockClear();
    navigation.params = new URLSearchParams(url.split('?')[1]);
    hook.rerender();
    act(() => vi.runOnlyPendingTimers());
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(hook.result.current.startDate).toBe('2026-01-01');
    for (const from of ['2026-02-01', '2026-01-01']) {
      navigation.params = new URLSearchParams(`from=${from}&to=&status=all`);
      hook.rerender();
      expect(hook.result.current.startDate).toBe(from);
    }
  });
});
