'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function useReportFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isExportView = searchParams.get('view') === 'export';
  const [filterClientId, setFilterClientId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [filterShiftId, setFilterShiftId] = useState<string | null>(null);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState('start_at');

  /* eslint-disable react-hooks/set-state-in-effect -- URL navigation is the external state source. */
  useEffect(() => {
    const statusParam = searchParams.get('status');
    const periodParam = searchParams.get('period');
    const shiftParam = searchParams.get('shiftId');
    const clientIdParam = searchParams.get('clientId');
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const recordStatusParam = searchParams.get('recordStatus');
    const orderParam = searchParams.get('order');
    const orderByParam = searchParams.get('orderBy');

    setOnlyPending(statusParam === 'unapproved' && !isExportView);
    if (periodParam === 'current_month') {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      // Keep calendar dates in local time; toISOString() shifts them back a day in JST.
      const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      setStartDate(formatDate(firstDay));
      setEndDate(formatDate(lastDay));
    } else {
      if (fromParam) setStartDate(fromParam);
      if (toParam) setEndDate(toParam);
    }
    setFilterShiftId(shiftParam || null);
    if (clientIdParam) setFilterClientId(clientIdParam);
    setFilterStatus(recordStatusParam || (isExportView ? 'approved' : 'all'));
    if (orderParam === 'asc' || orderParam === 'desc') setOrder(orderParam);
    if (orderByParam) setOrderBy(orderByParam);
  }, [searchParams, isExportView]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
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
    setFilterStatus,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    onlyPending,
    setOnlyPending,
    filterShiftId,
    order,
    setOrder,
    orderBy,
    setOrderBy,
    isCurrentMonth: searchParams.get('period') === 'current_month',
    isExportView,
  };
}
