'use client';

import React, { forwardRef } from 'react';
import { Paper } from '@mui/material';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg, DateSelectArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';

// ★修正： boolean を false に変更し、FullCalendarの仕様に完全に一致させました
type HeaderToolbarConfig = {
    left?: string;
    center?: string;
    right?: string;
} | false;

type Props = {
    events: EventInput[];
    initialView: string;
    headerToolbar: HeaderToolbarConfig;
    buttonText?: Record<string, string>;
    selectable?: boolean;
    onEventClick?: (info: EventClickArg) => void;
    onDateSelect?: (info: DateSelectArg) => void;
    noEventsText?: string;
};

export const ShiftCalendarViewer = forwardRef<FullCalendar, Props>(({
    events, initialView, headerToolbar, buttonText, selectable = false, onEventClick, onDateSelect, noEventsText
}, ref) => {
    return (
        <Paper sx={{
            display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)',
            borderRadius: 3, p: 2, boxShadow: 'none', border: '1px solid #E3E5E8',
            '& .fc': {
                height: '100%',
                bgcolor: 'white',
                '--fc-button-bg-color': '#2255CC',
                '--fc-button-border-color': '#2255CC',
                '--fc-button-hover-bg-color': '#003399',
                '--fc-button-hover-border-color': '#003399',
                '--fc-button-active-bg-color': '#003399',
                '--fc-button-active-border-color': '#003399',
                '--fc-today-bg-color': '#F0F5FF',
                '--fc-border-color': '#E3E5E8',
                '--fc-event-text-color': '#fff',
                fontFamily: 'inherit',
            },
            '& .fc-button': {
                textTransform: 'capitalize',
                borderRadius: '6px',
                fontWeight: 'bold',
                boxShadow: 'none !important',
            },
            '& .fc-toolbar-title': {
                fontSize: '1.25rem',
                fontWeight: 'bold',
                color: '#060607'
            },
            '& .fc-col-header-cell-cushion': {
                color: '#6D6F78',
                padding: '8px 0'
            },
            '& .fc-event-time': {
                fontWeight: 'bold',
                marginRight: '4px'
            },
            '& .fc-list-day-cushion': {
                backgroundColor: '#F0F5FF !important',
                color: '#2255CC',
                fontWeight: 'bold',
            },
            '& .fc-list-event:hover td': {
                backgroundColor: '#F8F9FA',
                cursor: 'pointer'
            }
        }}>
            <FullCalendar
                ref={ref}
                plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, rrulePlugin]}
                initialView={initialView}
                headerToolbar={headerToolbar}
                buttonText={buttonText}
                locale="ja"
                events={events}
                selectable={selectable}
                editable={false}
                displayEventTime={true}
                eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: false, hour12: false }}
                select={onDateSelect}
                eventClick={onEventClick}
                dayMaxEvents={true}
                noEventsText={noEventsText}
            />
        </Paper>
    );
});

ShiftCalendarViewer.displayName = 'ShiftCalendarViewer';