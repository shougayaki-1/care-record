// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  clients: new Map<string, Deferred<{ data: Array<{ id: string; name: string }> }>>(),
}));

vi.mock('@/app/actions/shift', () => ({
  getShifts: vi.fn(),
  getShiftPatterns: vi.fn(),
}));
vi.mock('@/utils/shiftHelper', () => ({ convertToCalendarEvents: vi.fn(() => []) }));
vi.mock('@/utils/permissions', () => ({ checkShiftPermission: vi.fn(() => false) }));
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const response = () => {
      if (table === 'clients') return testState.clients.get(String(filters.organization_id))?.promise ?? Promise.resolve({ data: [] });
      if (table === 'staffs') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [], count: 0 });
    };
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return query;
      },
      is: () => query,
      order: () => query,
      or: () => query,
    };
    query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => response().then(resolve, reject);
    return query;
  };
  return { supabase: { from } };
});

import { useShiftData } from './useShiftData';

const organization = (id: string) => ({ id, role: 'owner', effectivePermissions: { shifts: { edit: 'all' } } as never });

describe('useShiftData', () => {
  it('does not let master data from a former organization overwrite the current organization', async () => {
    const organizationA = organization('organization-a');
    const organizationB = organization('organization-b');
    const clientsA = deferred<{ data: Array<{ id: string; name: string }> }>();
    const clientsB = deferred<{ data: Array<{ id: string; name: string }> }>();
    testState.clients = new Map([
      ['organization-a', clientsA],
      ['organization-b', clientsB],
    ]);

    const { result, rerender } = renderHook(
      ({ currentOrg }) => useShiftData({
        currentOrg,
        userId: null,
        showToast: vi.fn(),
        calendarRef: { current: null },
        activeTab: 'fullCalendar',
        selectedStaffId: 'all',
        selectedClientId: 'all',
      }),
      { initialProps: { currentOrg: organizationA } },
    );

    act(() => {
      void result.current.fetchMasterData();
    });
    rerender({ currentOrg: organizationB });
    act(() => {
      void result.current.fetchMasterData();
    });

    await act(async () => {
      clientsB.resolve({ data: [{ id: 'client-b', name: 'Client B' }] });
      await clientsB.promise;
    });
    await waitFor(() => expect(result.current.clients).toEqual([{ id: 'client-b', name: 'Client B' }]));

    await act(async () => {
      clientsA.resolve({ data: [{ id: 'client-a', name: 'Client A' }] });
      await clientsA.promise;
    });
    expect(result.current.clients).toEqual([{ id: 'client-b', name: 'Client B' }]);
  });
});
