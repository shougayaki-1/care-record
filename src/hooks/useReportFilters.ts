'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function currentMonthDates() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    start: `${month}-01`,
    end: `${month}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
  };
}

function datesFromUrl(params: Pick<URLSearchParams, 'get'>, isExportView: boolean) {
  const month = currentMonthDates();
  if (params.get('period') === 'current_month') return month;
  const isPending = !isExportView && (params.get('status') === 'unapproved' || params.get('recordStatus') === 'pending');
  return {
    start: params.get('from') ?? (isPending ? '' : month.start),
    end: params.get('to') ?? '',
  };
}

export function useReportFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isExportView = searchParams.get('view') === 'export';
  const [filterClientId, setFilterClientId] = useState('all');
  const [filterStatus, setFilterStatus] = useState(() => searchParams.get('recordStatus') || (isExportView ? 'approved' : 'all'));
  const [startDate, setStartDate] = useState(() => datesFromUrl(searchParams, isExportView).start);
  const [endDate, setEndDate] = useState(() => datesFromUrl(searchParams, isExportView).end);
  const [onlyPending, setOnlyPending] = useState(() => searchParams.get('status') === 'unapproved' && !isExportView);
  const [filterShiftId, setFilterShiftId] = useState<string | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState('start_at');

  /* eslint-disable react-hooks/set-state-in-effect -- URL navigation is the external state source. */
  useEffect(() => {
    const statusParam = searchParams.get('status');
    const shiftParam = searchParams.get('shiftId');
    const clientIdParam = searchParams.get('clientId');
    const recordStatusParam = searchParams.get('recordStatus');
    const orderParam = searchParams.get('order');
    const orderByParam = searchParams.get('orderBy');

    setOnlyPending(statusParam === 'unapproved' && !isExportView);
    const dates = datesFromUrl(searchParams, isExportView);
    setStartDate(dates.start);
    setEndDate(dates.end);
    setFilterShiftId(shiftParam || null);
    if (clientIdParam) setFilterClientId(clientIdParam);
    setFilterStatus(recordStatusParam || (isExportView ? 'approved' : 'all'));
    if (orderParam === 'asc' || orderParam === 'desc') setOrder(orderParam);
    if (orderByParam) setOrderBy(orderByParam);
  }, [searchParams, isExportView]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateFilterStatus = (value: string) => {
    if (value === 'pending' && startDate === currentMonthDates().start && !endDate) setStartDate('');
    setFilterStatus(value);
  };
  const updateOnlyPending = (value: boolean) => {
    if (value && startDate === currentMonthDates().start && !endDate) setStartDate('');
    setOnlyPending(value);
  };

  useEffect(() => {
    const params = new URLSearchParams();
    if (filterClientId !== 'all') params.set('clientId', filterClientId);
    if (filterStatus !== 'all') params.set('recordStatus', filterStatus);
    if (startDate) params.set('from', startDate);
    if (endDate) params.set('to', endDate);
    if (onlyPending) params.set('status', 'unapproved');
    if (filterShiftId) params.set('shiftId', filterShiftId);
    if (order !== 'desc') params.set('order', order);
    if (orderBy !== 'start_at') params.set('orderBy', orderBy);
    if (isExportView) params.set('view', 'export');
    if (searchParams.get('period') === 'current_month') {
      const { start: monthStart, end: monthEnd } = currentMonthDates();
      // Preserve the named shortcut only while its dates are unchanged. Once edited,
      // from/to become the source of truth and the URL must not reset them on reload.
      if (startDate === monthStart && endDate === monthEnd) params.set('period', 'current_month');
    }

    const nextQuery = params.toString();
    if (nextQuery === searchParams.toString()) return;
    const timer = window.setTimeout(() => {
      router.replace(nextQuery ? `/app/reports?${nextQuery}` : '/app/reports', { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    endDate,
    filterClientId,
    filterShiftId,
    filterStatus,
    onlyPending,
    order,
    orderBy,
    router,
    searchParams,
    startDate,
    isExportView,
  ]);

  return {
    filterClientId,
    setFilterClientId,
    filterStatus,
    setFilterStatus: updateFilterStatus,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    onlyPending,
    setOnlyPending: updateOnlyPending,
    filterShiftId,
    order,
    setOrder,
    orderBy,
    setOrderBy,
    isCurrentMonth: searchParams.get('period') === 'current_month',
    isExportView,
  };
}
