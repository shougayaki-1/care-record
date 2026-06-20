'use client';

import { useState, useEffect, useCallback, RefObject } from 'react';
import { EventInput } from '@fullcalendar/core';
import FullCalendar from '@fullcalendar/react';
import { supabase } from '@/lib/supabase';
import { getShifts, getShiftPatterns } from '@/app/actions/shift';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ClientData, StaffData } from '@/components/shifts/ShiftFormModal';

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

type UseShiftDataParams = {
    currentOrg: { id: string; role: string } | null;
    showToast: (msg: string, severity?: 'success' | 'info' | 'warning' | 'error') => void;
    calendarRef: RefObject<FullCalendar | null>;
    activeTab: TabId;
    selectedStaffId: string;
    selectedClientId: string;
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

    const fetchData = useCallback(async (isBackground = false) => {
        if (!currentOrg) return;
        if (!isBackground) setInitialLoading(true);
        setIsFetching(true);

        const calendarApi = calendarRef.current?.getApi();
        const currentCalendarDate = calendarApi?.getDate();

        try {
            const fetchedPatterns = await getShiftPatterns(currentOrg.id);
            setPatterns((fetchedPatterns as unknown as FetchedPatternData[]) || []);

            const start = new Date(); start.setMonth(start.getMonth() - 2);
            const end = new Date(); end.setMonth(end.getMonth() + 6);
            const fetchedShifts = await getShifts(currentOrg.id, start.toISOString(), end.toISOString());
            const typedShifts = (fetchedShifts as unknown as FetchedShiftData[]) || [];

            typedShifts.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
            setRawShifts(typedShifts);
            setEvents(convertToCalendarEvents(typedShifts, false));

            const { count: unsyncedCountResult } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', currentOrg.id)
                .is('google_event_id', null);
            setUnsyncedCount(unsyncedCountResult || 0);

            if (calendarApi && currentCalendarDate) {
                setTimeout(() => { calendarApi.gotoDate(currentCalendarDate); }, 10);
            }
        } catch (error) {
            console.error(error);
            showToast('データの取得に失敗しました', 'error');
        } finally {
            setInitialLoading(false);
            setIsFetching(false);
        }
    }, [currentOrg, showToast, calendarRef]);

    useEffect(() => {
        if (!currentUserId || rawShifts.length === 0) {
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

        const isEditable = activeTab === 'fullCalendar' && ['owner', 'manager'].includes(currentOrg?.role || '');
        setEvents(convertToCalendarEvents(filtered, !isEditable));
    }, [rawShifts, activeTab, selectedStaffId, selectedClientId, currentStaffId, currentUserId, currentOrg]);

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
    };
};
