'use client';

import { useState, useMemo } from 'react';
import { EventInput } from '@fullcalendar/core';
import { convertToCalendarEvents, FetchedShiftData } from '@/utils/shiftHelper';
import { Workspace } from '@/context/WorkspaceContext';

export function useShiftFilters(
    currentOrg: Workspace | null,
    rawShifts: FetchedShiftData[],
    currentStaffId: string | null,
    currentUserId: string
) {
    const [tabIndex, setTabIndex] = useState(1);
    const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
    const [selectedClientId, setSelectedClientId] = useState<string>('all');

    const [targetMonth, setTargetMonth] = useState<string>(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const events = useMemo<EventInput[]>(() => {
        if (!currentUserId || rawShifts.length === 0) {
            return [];
        }

        const filtered = rawShifts.filter(shift => {
            if (tabIndex === 2) {
                if (!currentStaffId) return false;
                return shift.shift_staffs.some(s => s.staff_id === currentStaffId);
            }
            if (tabIndex === 3) {
                if (selectedStaffId === 'all') return true;
                return shift.shift_staffs.some(s => s.staff_id === selectedStaffId);
            }
            if (tabIndex === 4) {
                if (selectedClientId === 'all') return true;
                return shift.client_id === selectedClientId;
            }
            return true;
        });

        const isEditable = tabIndex === 1 && ['owner', 'manager'].includes(currentOrg?.role || '');
        return convertToCalendarEvents(filtered, !isEditable);
    }, [rawShifts, tabIndex, selectedStaffId, selectedClientId, currentStaffId, currentUserId, currentOrg]);

    return {
        tabIndex,
        setTabIndex,
        selectedStaffId,
        setSelectedStaffId,
        selectedClientId,
        setSelectedClientId,
        targetMonth,
        setTargetMonth,
        events
    };
}