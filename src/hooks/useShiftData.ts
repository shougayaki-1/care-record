'use client';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import type { EventInput } from '@fullcalendar/core';
import type FullCalendar from '@fullcalendar/react';
import { supabase } from '@/lib/supabase';
import { getShifts, getShiftPatterns, type ShiftQueryFilter } from '@/app/actions/shift';
import { convertToCalendarEvents } from '@/utils/shiftHelper';
import type { ShiftListItem, ShiftPatternData, ClientData, StaffData } from '@/features/shifts/types';
import { toShiftPatternData } from '@/features/shifts/adapters';
import { checkShiftPermission, type RolePermissions } from '@/utils/permissions';
import { useRequestGeneration } from '@/hooks/useRequestGeneration';

export type ShiftFetchStatus = 'loading' | 'success' | 'error';

type TabId = 'patterns' | 'fullCalendar' | 'myShift' | 'byStaff' | 'byClient';

export type ShiftDateRange = {
    start: Date;
    end: Date;
};

type UseShiftDataParams = {
    currentOrg: { id: string; role: string; effectivePermissions: RolePermissions } | null;
    userId: string | null;
    showToast: (msg: string, severity?: 'success' | 'info' | 'warning' | 'error') => void;
    calendarRef: RefObject<FullCalendar | null>;
    activeTab: TabId;
    selectedStaffId: string;
    selectedClientId: string;
};

const getCurrentMonthRange = (): ShiftDateRange => {
    const now = new Date();
    return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
};

export const useShiftData = ({
    currentOrg,
    userId,
    showToast,
    calendarRef,
    activeTab,
    selectedStaffId,
    selectedClientId,
}: UseShiftDataParams) => {
    const [initialLoading, setInitialLoading] = useState(true);
    const [isFetching, setIsFetching] = useState(false);

    const [rawShifts, setRawShifts] = useState<ShiftListItem[]>([]);
    const [patterns, setPatterns] = useState<ShiftPatternData[]>([]);
    const [events, setEvents] = useState<EventInput[]>([]);

    const [clients, setClients] = useState<ClientData[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);

    const currentUserId = userId ?? '';
    const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);
    const [unsyncedState, setUnsyncedState] = useState<{ orgId?: string; status: ShiftFetchStatus; count: number | null }>({ status: 'loading', count: null });
    const [masterState, setMasterState] = useState<{ orgId?: string; status: ShiftFetchStatus }>({ status: 'loading' });
    const masterDataStatus = masterState.orgId === currentOrg?.id ? masterState.status : 'loading';
    const unsyncedCountStatus = unsyncedState.orgId === currentOrg?.id ? unsyncedState.status : 'loading';
    const unsyncedCount = unsyncedCountStatus === 'success' ? unsyncedState.count : null;

    const masterDataReadyRef = useRef(false);
    const countScopeRef = useRef(currentOrg?.id);
    const activeTabRef = useRef(activeTab);
    const selectedStaffIdRef = useRef(selectedStaffId);
    const selectedClientIdRef = useRef(selectedClientId);
    const currentStaffIdRef = useRef(currentStaffId);
    const { next: nextFetch, invalidate: invalidateFetch, isCurrent: isCurrentFetch } = useRequestGeneration();
    const { next: nextMasterData, invalidate: invalidateMasterData, isCurrent: isCurrentMasterData } = useRequestGeneration();
    const { next: nextPatterns, invalidate: invalidatePatterns, isCurrent: isCurrentPatterns } = useRequestGeneration();
    const { next: nextUnsyncedCount, invalidate: invalidateUnsyncedCount, isCurrent: isCurrentUnsyncedCount } = useRequestGeneration();

    useEffect(() => {
        countScopeRef.current = currentOrg?.id;
        invalidateFetch();
        invalidateMasterData();
        invalidatePatterns();
        invalidateUnsyncedCount();
        masterDataReadyRef.current = false;
        let active = true;
        queueMicrotask(() => {
            if (!active) return;
            setClients([]);
            setStaffs([]);
            setCurrentStaffId(null);
            setPatterns([]);
            setRawShifts([]);
            setEvents([]);
            setUnsyncedState({ orgId: currentOrg?.id, status: 'loading', count: null });
            setMasterState({ orgId: currentOrg?.id, status: 'loading' });
        });
        return () => {
            active = false;
            countScopeRef.current = undefined;
            invalidateFetch();
            invalidateMasterData();
            invalidatePatterns();
            invalidateUnsyncedCount();
        };
    }, [currentOrg?.id, invalidateFetch, invalidateMasterData, invalidatePatterns, invalidateUnsyncedCount]);

    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);

    useEffect(() => {
        selectedStaffIdRef.current = selectedStaffId;
    }, [selectedStaffId]);

    useEffect(() => {
        selectedClientIdRef.current = selectedClientId;
    }, [selectedClientId]);

    useEffect(() => {
        currentStaffIdRef.current = currentStaffId;
    }, [currentStaffId]);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        const generation = nextMasterData();
        const isStale = () => !isCurrentMasterData(generation);
        masterDataReadyRef.current = false;
        setMasterState({ orgId: currentOrg.id, status: 'loading' });
        try {
            const { data: c, error: clientsError } = await supabase
                .from('clients')
                .select('id, name')
                .eq('organization_id', currentOrg.id);
            if (isStale()) return;
            if (clientsError || !c) throw new Error('Master data unavailable');

            const { data: s, error: staffsError } = await supabase
                .from('staffs')
                .select('id, name, user_id')
                .eq('organization_id', currentOrg.id)
                .is('archived_at', null)
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });
            if (isStale()) return;
            if (staffsError || !s) throw new Error('Master data unavailable');
            setClients(c);
            const parsed = s.map(item => ({
                id: item.id,
                name: item.name,
                type: item.user_id ? 'member' as const : 'ghost' as const,
            }));
            setStaffs(parsed);
            setCurrentStaffId(s.find(item => item.user_id === currentUserId)?.id ?? null);
            masterDataReadyRef.current = true;
            setMasterState({ orgId: currentOrg.id, status: 'success' });
        } catch {
            if (isStale()) return;
            setMasterState({ orgId: currentOrg.id, status: 'error' });
        }
    }, [currentOrg, currentUserId, isCurrentMasterData, nextMasterData]);

    const fetchUnsyncedCount = useCallback(async () => {
        if (!currentOrg) return;
        const generation = nextUnsyncedCount();
        const isStale = () => !isCurrentUnsyncedCount(generation);
        setUnsyncedState({ orgId: currentOrg.id, status: 'loading', count: null });
        try {
            const { count, error } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', currentOrg.id)
                .is('deleted_at', null)
                .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)');
            if (isStale()) return;
            if (error || count === null) throw new Error('Sync count unavailable');
            setUnsyncedState({ orgId: currentOrg.id, status: 'success', count });
        } catch {
            if (isStale()) return;
            setUnsyncedState({ orgId: currentOrg.id, status: 'error', count: null });
        }
    }, [currentOrg, isCurrentUnsyncedCount, nextUnsyncedCount]);

    // A confirmed sync result supersedes an in-flight count query.
    const setUnsyncedCount = useCallback((count: number) => {
        if (!currentOrg?.id || countScopeRef.current !== currentOrg.id) return;
        invalidateUnsyncedCount();
        setUnsyncedState({ orgId: currentOrg?.id, status: 'success', count });
    }, [currentOrg, invalidateUnsyncedCount]);

    const fetchPatterns = useCallback(async () => {
        if (!currentOrg) return;
        const generation = nextPatterns();
        const isStale = () => !isCurrentPatterns(generation);
        const fetchedPatterns = await readActionResult(getShiftPatterns(currentOrg.id));
        if (isStale()) return;
        setPatterns(fetchedPatterns.map(toShiftPatternData));
    }, [currentOrg, isCurrentPatterns, nextPatterns]);

    const getShiftFilter = useCallback((): ShiftQueryFilter | null => {
        const tab = activeTabRef.current;
        if (tab === 'myShift') {
            return currentStaffIdRef.current ? { staffId: currentStaffIdRef.current } : null;
        }
        if (tab === 'byStaff' && selectedStaffIdRef.current !== 'all') {
            return { staffId: selectedStaffIdRef.current };
        }
        if (tab === 'byClient' && selectedClientIdRef.current !== 'all') {
            return { clientId: selectedClientIdRef.current };
        }
        return {};
    }, []);

    const fetchData = useCallback(async (isBackground = false, range?: ShiftDateRange) => {
        if (!currentOrg) return;
        const tab = activeTabRef.current;
        // myShift tab requires knowing the current staff — skip until master data is ready
        if (tab === 'myShift' && !masterDataReadyRef.current) {
            setInitialLoading(false);
            setIsFetching(false);
            return;
        }
        if (!isBackground) setInitialLoading(true);
        setIsFetching(true);

        // 取得が複数同時に走った際、古い月のレスポンスが後着して
        // 新しい月の表示を上書きしないよう、最新リクエストだけ反映する
        const generation = nextFetch();
        const isStale = () => !isCurrentFetch(generation);

        const currentView = calendarRef.current?.getApi()?.view;
        const targetRange = range || (currentView
            ? { start: currentView.activeStart, end: currentView.activeEnd }
            : getCurrentMonthRange());

        try {
            if (tab === 'patterns') {
                await fetchPatterns();
                return;
            }

            const filter = getShiftFilter();
            if (!filter) {
                if (isStale()) return;
                setRawShifts([]);
                setEvents([]);
                return;
            }

            const fetchedShifts = await readActionResult(getShifts(
                currentOrg.id,
                targetRange.start.toISOString(),
                targetRange.end.toISOString(),
                filter
            ));
            if (isStale()) return;
            setRawShifts(fetchedShifts);
            const isEditable = masterDataReadyRef.current && tab === 'fullCalendar' && checkShiftPermission(currentOrg.effectivePermissions, 'edit', true);
            setEvents(convertToCalendarEvents(fetchedShifts, !isEditable));
            void fetchUnsyncedCount().catch(console.error);
        } catch (error) {
            if (isStale()) return;
            console.error(error);
            showToast(getActionErrorMessage(error, 'データの取得に失敗しました'), 'error');
        } finally {
            if (!isStale()) {
                setInitialLoading(false);
                setIsFetching(false);
            }
        }
    }, [currentOrg, showToast, calendarRef, fetchPatterns, getShiftFilter, fetchUnsyncedCount, isCurrentFetch, nextFetch]);

    useEffect(() => {
        queueMicrotask(() => {
            if (rawShifts.length === 0 || (activeTab === 'myShift' && !currentStaffId)) {
                setEvents([]);
                return;
            }

            const filtered = rawShifts.filter(shift => {
                if (activeTab === 'myShift') {
                    return shift.shift_staffs.some(s => s.staff_id === currentStaffId);
                }
                if (activeTab === 'byStaff') {
                    if (selectedStaffId === 'all') return true;
                    return shift.shift_staffs.some(s => s.staff_id === selectedStaffId);
                }
                if (activeTab === 'byClient') {
                    if (selectedClientId === 'all') return true;
                    return shift.client_id === selectedClientId;
                }
                return true;
            });

            const isEditable = Boolean(masterDataStatus === 'success' && currentOrg && activeTab === 'fullCalendar' && checkShiftPermission(currentOrg.effectivePermissions, 'edit', true));
            setEvents(convertToCalendarEvents(filtered, !isEditable));
        });
    }, [rawShifts, activeTab, selectedStaffId, selectedClientId, currentStaffId, currentOrg, masterDataStatus]);

    return {
        rawShifts,
        patterns,
        events,
        clients,
        staffs,
        currentUserId,
        currentStaffId,
        initialLoading,
        isFetching,
        unsyncedCount,
        unsyncedCountStatus,
        masterDataStatus,
        setUnsyncedCount,
        fetchData,
        fetchMasterData,
        fetchPatterns,
        fetchUnsyncedCount,
    };
};
