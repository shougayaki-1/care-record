'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';

const date = z.union([z.literal(''), z.iso.date()]);
const preferencesSchema = z.object({
  version: z.literal(1),
  filterClientId: z.string().min(1).max(100),
  filterStatus: z.enum(['all', 'pending', 'approved', 'remanded']),
  startDate: date,
  endDate: date,
  onlyPending: z.boolean(),
  order: z.enum(['asc', 'desc']),
  orderBy: z.enum(['start_at', 'client_name']),
  isCurrentMonth: z.boolean(),
});
type Preferences = z.infer<typeof preferencesSchema>;
type Filters = Preferences & { filterShiftId: string | null };
type Options = { userId: string | null; organizationId?: string; clients?: readonly { id: string }[] };

function currentMonthDates() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')!.value);
  const month = Number(parts.find((part) => part.type === 'month')!.value);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return { startDate: `${prefix}-01`, endDate: `${prefix}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` };
}

function defaults(isExportView: boolean): Filters {
  return {
    version: 1, filterClientId: 'all', filterStatus: isExportView ? 'approved' : 'all',
    startDate: currentMonthDates().startDate, endDate: '', onlyPending: false,
    order: 'desc', orderBy: 'start_at', isCurrentMonth: false, filterShiftId: null,
  };
}

function restore(key: string): Preferences | undefined {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(window.localStorage.getItem(key) ?? 'null'));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

function resolveFilters(params: URLSearchParams, saved: Preferences | undefined, isExportView: boolean, clients: readonly { id: string }[]): Filters {
  const filters = { ...defaults(isExportView), ...saved };
  if (params.has('clientId')) filters.filterClientId = params.get('clientId') || 'all';
  if (!clients.some((client) => client.id === filters.filterClientId)) filters.filterClientId = 'all';
  if (params.has('recordStatus')) {
    filters.filterStatus = preferencesSchema.shape.filterStatus.safeParse(params.get('recordStatus')).data ?? defaults(isExportView).filterStatus;
    // A single-status link must not inherit a saved pending-only switch.
    filters.onlyPending = false;
  }
  if (params.has('status')) {
    filters.onlyPending = params.get('status') === 'unapproved' && !isExportView;
    if (filters.onlyPending && !params.has('recordStatus')) filters.filterStatus = 'all';
  }
  if (params.get('period') === 'current_month') {
    filters.isCurrentMonth = true;
    if (!params.has('status')) filters.onlyPending = false;
  } else if (params.has('from') || params.has('to') || params.has('status') || params.has('recordStatus')) {
    filters.isCurrentMonth = false;
  }
  if (filters.isCurrentMonth) Object.assign(filters, currentMonthDates());
  else {
    const pendingEntry = !isExportView && (params.get('status') === 'unapproved' || params.get('recordStatus') === 'pending');
    if (pendingEntry && !saved) filters.startDate = '';
    if (params.has('from')) filters.startDate = date.safeParse(params.get('from')).data ?? defaults(isExportView).startDate;
    if (params.has('to')) filters.endDate = date.safeParse(params.get('to')).data ?? '';
  }
  if (isExportView) filters.onlyPending = false;
  if (params.has('order')) filters.order = preferencesSchema.shape.order.safeParse(params.get('order')).data ?? 'desc';
  if (params.has('orderBy')) filters.orderBy = preferencesSchema.shape.orderBy.safeParse(params.get('orderBy')).data ?? 'start_at';
  filters.filterShiftId = params.get('shiftId') || null;
  return filters;
}

function queryFor(filters: Filters, isExportView: boolean) {
  // Include empty dates and default/false values so reload and history cannot
  // reinterpret an explicit cleared value as a missing preference.
  const params = new URLSearchParams({
    clientId: filters.filterClientId, recordStatus: filters.filterStatus,
    from: filters.startDate, to: filters.endDate,
    status: filters.onlyPending ? 'unapproved' : 'all', order: filters.order, orderBy: filters.orderBy,
  });
  if (filters.filterShiftId) params.set('shiftId', filters.filterShiftId);
  if (filters.isCurrentMonth) params.set('period', 'current_month');
  if (isExportView) params.set('view', 'export');
  return params.toString();
}

export function useReportFilters({ userId, organizationId, clients }: Options) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const isExportView = searchParams.get('view') === 'export';
  const identity = userId && organizationId ? `${userId}:${organizationId}` : '';
  const key = identity ? `care-record-report-filters:v1:${identity}:${isExportView ? 'export' : 'list'}` : '';
  const [state, setState] = useState<{ key: string; identity: string; query: string; filters: Filters }>(() => ({
    key: '', identity: '', query: '', filters: defaults(isExportView),
  }));
  const ready = !!key && clients !== undefined && state.key === key;
  const filters = ready ? state.filters : defaults(isExportView);
  const canonicalQuery = queryFor(filters, isExportView);
  const synchronized = ready && (state.query === query || canonicalQuery === query);

  useEffect(() => {
    if (!key || !clients) return;
    if (state.key === key && state.query === query) return;
    // Our own replace acknowledges the existing state; do not restore again or
    // issue a second search. External navigation (including Back/Forward) resolves anew.
    const ownReplace = state.key === key && queryFor(state.filters, isExportView) === query;
    const identityChanged = !!state.identity && state.identity !== identity;
    const params = new URLSearchParams(identityChanged ? (isExportView ? 'view=export' : '') : query);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore external URL/storage after hydration and workspace resolution.
    setState({ key, identity, query, filters: ownReplace ? state.filters : resolveFilters(params, restore(key), isExportView, clients) });
  }, [key, identity, query, isExportView, clients, state]);

  useEffect(() => {
    if (!synchronized) return;
    try {
      // Parsing projects the allowed fields: no shift ID, selections, results or PHI.
      window.localStorage.setItem(key, JSON.stringify(preferencesSchema.parse(filters)));
    } catch { /* Storage may be blocked or full; URL filters remain usable. */ }
    if (canonicalQuery === query) return;
    const timer = window.setTimeout(() => router.replace(`/app/reports?${canonicalQuery}`, { scroll: false }), 0);
    return () => window.clearTimeout(timer);
  }, [synchronized, key, filters, canonicalQuery, query, router]);

  const update = (patch: Partial<Filters>) => {
    setState((previous) => ({ ...previous, filters: { ...previous.filters, ...patch } }));
  };
  const pendingPatch = (pending: boolean) => pending && !filters.isCurrentMonth && filters.startDate === currentMonthDates().startDate && !filters.endDate ? { startDate: '' } : {};

  return {
    ...filters, ready: synchronized, isExportView,
    setFilterClientId: (filterClientId: string) => update({ filterClientId }),
    setFilterStatus: (filterStatus: string) => update({ filterStatus: preferencesSchema.shape.filterStatus.parse(filterStatus), ...pendingPatch(filterStatus === 'pending') }),
    setStartDate: (startDate: string) => update({ startDate, isCurrentMonth: false }),
    setEndDate: (endDate: string) => update({ endDate, isCurrentMonth: false }),
    setOnlyPending: (onlyPending: boolean) => update({ onlyPending, ...pendingPatch(onlyPending) }),
    setOrder: (order: 'asc' | 'desc') => update({ order }),
    setOrderBy: (orderBy: string) => update({ orderBy: preferencesSchema.shape.orderBy.parse(orderBy) }),
    resetFilters: () => update(defaults(isExportView)),
  };
}
