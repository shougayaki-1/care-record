'use client';

import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import type { EventInput } from '@fullcalendar/core';
import type FullCalendar from '@fullcalendar/react';
import { supabase } from '@/lib/supabase';
import { getShifts, getShiftPatterns, type ShiftQueryFilter } from '@/app/actions/shift';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ClientData, StaffData } from '@/components/shifts/ShiftFormModal';
import { checkShiftPermission, type RolePermissions } from '@/utils/permissions';

export type FetchedPatternData = {
    id: string;
    client_id: string;
    title: string;
    start_time: string;
    end_time: string;
    rrule: string;
    clients: { name: string } | null;
    shift_pattern_staffs: { staff_id: string; staffs: { name: string } | null; }[];
};

type TabId = 'patterns' | 'fullCalendar' | 'myShift' | 'byStaff' | 'byClient';

export type ShiftDateRange = {
    start: Date;
    end: Date;
};

type UseShiftDataParams = {
    currentOrg: { id: string; role: string; effectivePermissions: RolePermissions } | null;
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
    showToast,
    calendarRef,
    activeTab,
    selectedStaffId,
    selectedClientId,
}: UseShiftDataParams) => {
    const [initialLoading, setInitialLoading] = useState(true);
    const [isFetching, setIsFetching] = useState(false);

    const [rawShifts, setRawShifts] = useState<FetchedShiftData[]>([]);
    const [patterns, setPatterns] = useState<FetchedPatternData[]>([]);
    const [events, setEvents] = useState<EventInput[]>([]);

    const [clients, setClients] = useState<ClientData[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);

    const [currentUserId, setCurrentUserId] = useState('');
    const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);
    const [unsyncedCount, setUnsyncedCount] = useState(0);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) setCurrentUserId(user.id);
        });
    }, []);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: c } = await supabase
                .from('clients')
                .select('id, name')
                .eq('organization_id', currentOrg.id);
            if (c) setClients(c as ClientData[]);

            const { data: s } = await supabase
                .from('staffs')
                .select('id, name, user_id')
                .eq('organization_id', currentOrg.id)
                .is('archived_at', null)
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });
            if (s) {
                const parsed = s.map(item => ({
                    id: item.id,
                    name: item.name,
                    type: item.user_id ? 'member' as const : 'ghost' as const,
                }));
                setStaffs(parsed);

                if (currentUserId) {
                    const me = parsed.find(item => s.find(sd => sd.id === item.id)?.user_id === currentUserId);
                    if (me) setCurrentStaffId(me.id);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }, [currentOrg, currentUserId]);

    const fetchUnsyncedCount = useCallback(async () => {
        if (!currentOrg) return;
        const { count: unsyncedCountResult } = await supabase
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', currentOrg.id)
            .is('deleted_at', null)
            .or('google_event_id.is.null,google_sync_status.in.(pending_upsert,failed)');
        setUnsyncedCount(unsyncedCountResult || 0);
    }, [currentOrg]);

    const fetchPatterns = useCallback(async () => {
        if (!currentOrg) return;
        const fetchedPatterns = await getShiftPatterns(currentOrg.id);
        setPatterns((fetchedPatterns as unknown as FetchedPatternData[]) || []);
    }, [currentOrg]);

    const getShiftFilter = useCallback((): ShiftQueryFilter | null => {
        if (activeTab === 'myShift') {
            return currentStaffId ? { staffId: currentStaffId } : null;
        }
        if (activeTab === 'byStaff' && selectedStaffId !== 'all') {
            return { staffId: selectedStaffId };
        }
        if (activeTab === 'byClient' && selectedClientId !== 'all') {
            return { clientId: selectedClientId };
        }
        return {};
    }, [activeTab, currentStaffId, selectedStaffId, selectedClientId]);

    const fetchSeqRef = useRef(0);

    const fetchData = useCallback(async (isBackground = false, range?: ShiftDateRange) => {
        if (!currentOrg) return;
        if (!isBackground) setInitialLoading(true);
        setIsFetching(true);

        // 取得が複数同時に走った際、古い月のレスポンスが後着して
        // 新しい月の表示を上書きしないよう、最新リクエストだけ反映する
        const seq = ++fetchSeqRef.current;
        const isStale = () => seq !== fetchSeqRef.current;

        const currentView = calendarRef.current?.getApi()?.view;
        const targetRange = range || (currentView
            ? { start: currentView.activeStart, end: currentView.activeEnd }
            : getCurrentMonthRange());

        try {
            if (activeTab === 'patterns') {
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

            const fetchedShifts = await getShifts(
                currentOrg.id,
                targetRange.start.toISOString(),
                targetRange.end.toISOString(),
                filter
            );
            if (isStale()) return;
            const typedShifts = (fetchedShifts as unknown as FetchedShiftData[]) || [];

            setRawShifts(typedShifts);
            const isEditable = activeTab === 'fullCalendar' && checkShiftPermission(currentOrg.effectivePermissions, 'edit', true);
            setEvents(convertToCalendarEvents(typedShifts, !isEditable));
            void fetchUnsyncedCount().catch(console.error);
        } catch (error) {
            console.error(error);
            showToast('データの取得に失敗しました', 'error');
        } finally {
            if (!isStale()) {
                setInitialLoading(false);
                setIsFetching(false);
            }
        }
    }, [currentOrg, showToast, calendarRef, activeTab, fetchPatterns, getShiftFilter, fetchUnsyncedCount]);

    useEffect(() => {
        if (rawShifts.length === 0) {
            setEvents([]);
            return;
        }

        if (activeTab === 'myShift' && !currentStaffId) {
            setEvents([]);
            return;
        }

        const filtered = rawShifts.filter(shift => {
            if (activeTab === 'myShift') {
                if (!currentStaffId) return false;
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

        const isEditable = Boolean(currentOrg && activeTab === 'fullCalendar' && checkShiftPermission(currentOrg.effectivePermissions, 'edit', true));
        setEvents(convertToCalendarEvents(filtered, !isEditable));
    }, [rawShifts, activeTab, selectedStaffId, selectedClientId, currentStaffId, currentOrg]);

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
        setUnsyncedCount,
        fetchData,
        fetchMasterData,
        fetchPatterns,
        fetchUnsyncedCount,
    };
};
