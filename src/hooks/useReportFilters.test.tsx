// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReportFilters } from './useReportFilters';

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}));

describe('useReportFilters', () => {
  beforeEach(() => {
    navigation.params = new URLSearchParams();
    navigation.replace.mockClear();
  });

  it('shows all dates by default for the unapproved and pending views', () => {
    navigation.params = new URLSearchParams('status=unapproved');
    const unapproved = renderHook(() => useReportFilters());
    expect(unapproved.result.current.startDate).toBe('');
    expect(unapproved.result.current.endDate).toBe('');
    expect(unapproved.result.current.onlyPending).toBe(true);
    unapproved.unmount();

    navigation.params = new URLSearchParams('recordStatus=pending');
    const pending = renderHook(() => useReportFilters());
    expect(pending.result.current.startDate).toBe('');
    expect(pending.result.current.endDate).toBe('');
    pending.unmount();
  });

  it('keeps explicitly requested dates in the unapproved view', () => {
    navigation.params = new URLSearchParams('status=unapproved&from=2026-01-01&to=2026-02-01');
    const { result } = renderHook(() => useReportFilters());
    expect(result.current.startDate).toBe('2026-01-01');
    expect(result.current.endDate).toBe('2026-02-01');
  });

  it('clears the ordinary default month when switching to pending', () => {
    const { result } = renderHook(() => useReportFilters());
    expect(result.current.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    act(() => result.current.setOnlyPending(true));
    expect(result.current.startDate).toBe('');
  });

  it('keeps an explicit current-month shortcut even for pending records', () => {
    navigation.params = new URLSearchParams('status=unapproved&period=current_month');
    const { result } = renderHook(() => useReportFilters());
    expect(result.current.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(result.current.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
