'use client';

import React from 'react';
import { Box } from '@mui/material';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg, DateSelectArg } from '@fullcalendar/core';
import { EventDropArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';
import { ShiftData } from '@/types';

type Props = {
    calendarRef: React.RefObject<FullCalendar | null>;
    events: EventInput[];
    isAdmin: boolean;
    handleEventChange: (info: EventDropArg | EventResizeDoneArg) => Promise<void>;
    setSelectedShift: (s: ShiftData | null) => void;
    setShiftModalOpen: (open: boolean) => void;
    showToast: (msg: string, severity?: 'success' | 'error' | 'info') => void;
};

export const ShiftCalendarTab = ({
    calendarRef, events, isAdmin, handleEventChange, setSelectedShift, setShiftModalOpen, showToast
}: Props) => {
    return (
        <Box sx={{ height: '100%' }}>
            <ShiftCalendarViewer
                ref={calendarRef}
                events={events}
                initialView="dayGridMonth"
                headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth' }}
                buttonText={{ listMonth: 'リスト', dayGridMonth: '月間', timeGridWeek: '週間' }}
                selectable={isAdmin}
                editable={isAdmin}
                onEventDrop={handleEventChange}
                onEventResize={handleEventChange}
                onDateSelect={(info: DateSelectArg) => {
                    if (!isAdmin) return;
                    setSelectedShift({
                        id: '', client_id: '', title: '', start_at: info.startStr, end_at: info.endStr,
                        status: 'published', cancel_reason: '', shift_staffs: []
                    });
                    setShiftModalOpen(true);
                }}
                onEventClick={(info: EventClickArg) => {
                    const { clientId, shiftId, isCancelled, shiftData } = info.event.extendedProps;
                    if (isAdmin) {
                        setSelectedShift(shiftData);
                        setShiftModalOpen(true);
                    } else {
                        if (isCancelled) {
                            showToast('このシフトは現在キャンセル（お休み）されています。', 'info');
                            return;
                        }
                        window.location.href = `/app/record/${clientId}?shiftId=${shiftId}`;
                    }
                }}
            />
        </Box>
    );
};