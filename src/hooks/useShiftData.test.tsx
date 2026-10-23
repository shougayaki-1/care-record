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

type QueryResult = { data?: Array<{ id: string; name: string; user_id?: string | null }> | null; count?: number | null; error?: unknown };

const testState = vi.hoisted(() => ({
  clients: new Map<string, Deferred<{ data: Array<{ id: string; name: string }> }>>(),
  responses: { clients: [], staffs: [], shifts: [] } as Record<string, Array<QueryResult | Promise<QueryResult>>>,
}));

vi.mock('@/app/actions/shift', () => ({
  getShifts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getShiftPatterns: vi.fn(),
}));
vi.mock('@/utils/shiftHelper', () => ({ convertToCalendarEvents: vi.fn(() => []) }));
vi.mock('@/utils/permissions', () => ({ checkShiftPermission: vi.fn(() => false) }));
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const response = () => {
      const queued = testState.responses[table]?.shift();
      if (queued) return Promise.resolve(queued);
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
import { getShifts } from '@/app/actions/shift';

beforeEach(() => {
  testState.clients.clear();
  testState.responses = { clients: [], staffs: [], shifts: [] };
  vi.clearAllMocks();
});
afterEach(cleanup);

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

function setup(activeTab: 'fullCalendar' | 'myShift' = 'fullCalendar') {
  const params = {
    currentOrg: organization('org'), userId: 'user', showToast: vi.fn(), calendarRef: { current: null },
    activeTab, selectedStaffId: 'all', selectedClientId: 'all',
  };
  return renderHook(() => useShiftData(params));
}

it.each(['clients', 'staffs'])('keeps master failure distinct when only %s fails and recovers on retry', async table => {
  testState.responses[table].push({ data: null, error: { message: 'private database detail' } });
  const { result } = setup('myShift');
  await act(async () => { await result.current.fetchMasterData(); });
  expect(result.current.masterDataStatus).toBe('error');
  await act(async () => { await result.current.fetchData(); });
  expect(getShifts).not.toHaveBeenCalled();
  testState.responses.staffs.push({ data: [{ id: 'me', name: 'Me', user_id: 'user' }], error: null });
  await act(async () => { await result.current.fetchMasterData(); });
  expect(result.current.masterDataStatus).toBe('success');
  await act(async () => { await result.current.fetchData(); });
  expect(getShifts).toHaveBeenCalledWith('org', expect.any(String), expect.any(String), { staffId: 'me' });
});

it('treats two empty master results as success', async () => {
  const { result } = setup();
  await act(async () => { await result.current.fetchMasterData(); });
  expect(result.current.masterDataStatus).toBe('success');
  expect(result.current.clients).toEqual([]);
  expect(result.current.staffs).toEqual([]);
});

it('does not turn count null with an error into zero and recovers with a successful zero', async () => {
  const { result } = setup();
  await act(async () => {});
  expect(result.current.unsyncedCountStatus).toBe('loading');
  expect(result.current.unsyncedCount).toBeNull();
  testState.responses.shifts.push({ count: 4, error: null }, { count: null, error: { message: 'private' } }, { count: 0, error: null });
  await act(async () => { await result.current.fetchUnsyncedCount(); });
  expect(result.current.unsyncedCount).toBe(4);
  await act(async () => { await result.current.fetchUnsyncedCount(); });
  expect(result.current.unsyncedCountStatus).toBe('error');
  expect(result.current.unsyncedCount).toBeNull();
  await act(async () => { await result.current.fetchUnsyncedCount(); });
  expect(result.current.unsyncedCountStatus).toBe('success');
  expect(result.current.unsyncedCount).toBe(0);
});

it.each(['master', 'count'] as const)('ignores older %s success and failure after a new request', async lane => {
  const { result } = setup();
  await act(async () => {});
  const table = lane === 'master' ? 'clients' : 'shifts';
  const fetch = () => lane === 'master' ? result.current.fetchMasterData() : result.current.fetchUnsyncedCount();
  const status = () => lane === 'master' ? result.current.masterDataStatus : result.current.unsyncedCountStatus;
  for (const oldResult of [{ data: [], count: 99, error: null }, { data: null, count: null, error: { message: 'old failure' } }]) {
    const old = deferred<QueryResult>();
    const latest = deferred<QueryResult>();
    testState.responses[table].push(old.promise, latest.promise);
    let oldRequest!: Promise<void>;
    let latestRequest!: Promise<void>;
    act(() => { oldRequest = fetch(); latestRequest = fetch(); });
    expect(status()).toBe('loading');
    await act(async () => { old.resolve(oldResult); await oldRequest; });
    expect(status()).toBe('loading');
    await act(async () => { latest.resolve({ data: [], count: 0, error: null }); await latestRequest; });
    expect(status()).toBe('success');
    if (lane === 'count') expect(result.current.unsyncedCount).toBe(0);
  }
});

it.each(['master', 'count'] as const)('keeps the latest %s error when an older success arrives last', async lane => {
  const { result } = setup();
  await act(async () => {});
  const old = deferred<QueryResult>();
  testState.responses[lane === 'master' ? 'clients' : 'shifts'].push(old.promise, { data: null, count: null, error: {} });
  const fetch = () => lane === 'master' ? result.current.fetchMasterData() : result.current.fetchUnsyncedCount();
  let pending!: Promise<void>;
  act(() => { pending = fetch(); });
  await act(async () => { await fetch(); });
  await act(async () => { old.resolve({ data: [], count: 0 }); await pending; });
  expect(lane === 'master' ? result.current.masterDataStatus : result.current.unsyncedCountStatus).toBe('error');
});

it('allows calendar browsing after master failure', async () => {
  testState.responses.clients.push({ data: null, error: {} });
  const { result } = setup();
  await act(async () => { await result.current.fetchMasterData(); await result.current.fetchData(); });
  expect(result.current.masterDataStatus).toBe('error');
  expect(getShifts).toHaveBeenCalled();
});

it.each([{ count: 9, error: null }, { count: null, error: {} }])('ignores a former organization count response: %j', async oldResponse => {
  const params = { userId: null, showToast: vi.fn(), calendarRef: { current: null }, activeTab: 'fullCalendar' as const, selectedStaffId: 'all', selectedClientId: 'all' };
  const { result, rerender } = renderHook(({ currentOrg }) => useShiftData({ ...params, currentOrg }), {
    initialProps: { currentOrg: organization('org-a') },
  });
  await act(async () => {});
  const old = deferred<QueryResult>();
  testState.responses.shifts.push(old.promise, { count: 2, error: null });
  let pending!: Promise<void>;
  act(() => { pending = result.current.fetchUnsyncedCount(); });
  rerender({ currentOrg: organization('org-b') });
  await act(async () => {});
  expect(result.current.unsyncedCount).toBeNull();
  await act(async () => { await result.current.fetchUnsyncedCount(); });
  await act(async () => { old.resolve(oldResponse); await pending; });
  expect(result.current.unsyncedCountStatus).toBe('success');
  expect(result.current.unsyncedCount).toBe(2);
});

it.each(['master', 'count'] as const)('handles rejected %s queries without completing successfully', async lane => {
  testState.responses[lane === 'master' ? 'clients' : 'shifts'].push(Promise.reject(new Error('network failure')));
  const { result } = setup();
  await act(async () => {
    if (lane === 'master') await result.current.fetchMasterData();
    else await result.current.fetchUnsyncedCount();
  });
  expect(lane === 'master' ? result.current.masterDataStatus : result.current.unsyncedCountStatus).toBe('error');
});

it('keeps sync count updates scoped and ignores older count queries after a confirmed sync result', async () => {
  const params = { userId: null, showToast: vi.fn(), calendarRef: { current: null }, activeTab: 'fullCalendar' as const, selectedStaffId: 'all', selectedClientId: 'all' };
  const { result, rerender } = renderHook(({ currentOrg }) => useShiftData({ ...params, currentOrg }), {
    initialProps: { currentOrg: organization('org-a') },
  });
  await act(async () => {});
  const previousScopeSetter = result.current.setUnsyncedCount;
  rerender({ currentOrg: organization('org-b') });
  await act(async () => {});
  const old = deferred<QueryResult>();
  testState.responses.shifts.push(old.promise);
  let pending!: Promise<void>;
  act(() => { pending = result.current.fetchUnsyncedCount(); });
  act(() => { previousScopeSetter(99); result.current.setUnsyncedCount(0); });
  await act(async () => { old.resolve({ count: 5, error: null }); await pending; });
  expect(result.current.unsyncedCountStatus).toBe('success');
  expect(result.current.unsyncedCount).toBe(0);
});

it.each(['master', 'count'] as const)('keeps the latest %s success when an older failure arrives last', async lane => {
  const { result } = setup();
  await act(async () => {});
  const old = deferred<QueryResult>();
  testState.responses[lane === 'master' ? 'clients' : 'shifts'].push(old.promise, { data: [], count: 0, error: null });
  const fetch = () => lane === 'master' ? result.current.fetchMasterData() : result.current.fetchUnsyncedCount();
  let pending!: Promise<void>;
  act(() => { pending = fetch(); });
  await act(async () => { await fetch(); });
  await act(async () => { old.resolve({ data: null, count: null, error: {} }); await pending; });
  expect(lane === 'master' ? result.current.masterDataStatus : result.current.unsyncedCountStatus).toBe('success');
  if (lane === 'count') expect(result.current.unsyncedCount).toBe(0);
});
