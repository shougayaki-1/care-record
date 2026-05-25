'use client';

import React from 'react';
import { Box } from '@mui/material';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg } from '@fullcalendar/core';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';

type Props = {
    calendarRef: React.RefObject<FullCalendar | null>;
    events: EventInput[];
    showToast: (msg: string, severity?: 'success' | 'error' | 'info') => void;
};

export const MyShiftTab = ({ calendarRef, events, showToast }: Props) => {
    return (
        <Box sx={{ height: '100%' }}>
            <ShiftCalendarViewer
                ref={calendarRef}
                events={events}
                initialView="listMonth"
                headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth' }}
                buttonText={{ listMonth: 'リスト', dayGridMonth: '月間', timeGridWeek: '週間' }}
                selectable={false}
                editable={false}
                onEventClick={(info: EventClickArg) => {
                    const { clientId, shiftId, isCancelled } = info.event.extendedProps;
                    if (isCancelled) {
                        showToast('このシフトは現在キャンセル（お休み）されています。', 'info');
                        return;
                    }
                    window.location.href = `/app/record/${clientId}?shiftId=${shiftId}`;
                }}
            />
        </Box>
    );
};