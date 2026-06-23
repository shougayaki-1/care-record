'use client';

import React, { forwardRef } from 'react';
import { Paper } from '@/components/ui/mui';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg, DateSelectArg, EventDropArg, DatesSetArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';

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
    editable?: boolean; // ★追加：D&Dとリサイズを許可するか
    onEventClick?: (info: EventClickArg) => void;
    onDateSelect?: (info: DateSelectArg) => void;
    onEventDrop?: (info: EventDropArg) => void;         // ★追加：D&D完了時
    onEventResize?: (info: EventResizeDoneArg) => void; // ★追加：リサイズ完了時
    onDatesSet?: (info: DatesSetArg) => void;
    noEventsText?: string;
};

export const ShiftCalendarViewer = forwardRef<FullCalendar, Props>(({
    events, initialView, headerToolbar, buttonText, selectable = false, editable = false,
    onEventClick, onDateSelect, onEventDrop, onEventResize, onDatesSet, noEventsText
}, ref) => {
    return (
        <Paper sx={(theme) => ({
            display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)',
            borderRadius: 3, p: 2, boxShadow: 'none', border: '1px solid', borderColor: 'divider',
            '& .fc': {
                height: '100%',
                bgcolor: theme.palette.background.paper,
                '--fc-button-bg-color': theme.palette.primary.main,
                '--fc-button-border-color': theme.palette.primary.main,
                '--fc-button-hover-bg-color': theme.palette.primary.dark,
                '--fc-button-hover-border-color': theme.palette.primary.dark,
                '--fc-button-active-bg-color': theme.palette.primary.dark,
                '--fc-button-active-border-color': theme.palette.primary.dark,
                '--fc-today-bg-color': theme.palette.background.tint,
                '--fc-border-color': theme.palette.divider,
                '--fc-event-text-color': '#fff',
                fontFamily: 'inherit',
            },
            '& .fc-button': { textTransform: 'capitalize', borderRadius: '6px', fontWeight: 'bold', boxShadow: 'none !important' },
            '& .fc-toolbar-title': { fontSize: '1.25rem', fontWeight: 'bold', color: '#060607' },
            '& .fc-col-header-cell-cushion': { color: '#6D6F78', padding: '8px 0' },
            '& .fc-event-time': { fontWeight: 'bold', marginRight: '4px' },
            '& .fc-list-day-cushion': { backgroundColor: `${theme.palette.background.tint} !important`, color: theme.palette.primary.main, fontWeight: 'bold' },
            '& .fc-list-event:hover td': { backgroundColor: '#F8F9FA', cursor: 'pointer' },
            // ★ドラッグ＆ドロップ時のUI調整
            '& .fc-event-dragging': { opacity: 0.8 },
            '& .fc-event-resizing': { opacity: 0.8 },
        })}>
            <FullCalendar
                ref={ref}
                // rrulePlugin を削除（実体化方式になったため不要）
                plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
                initialView={initialView}
                headerToolbar={headerToolbar}
                buttonText={buttonText}
                locale="ja"
                events={events}
                selectable={selectable}
                editable={editable}
                eventDrop={onEventDrop}
                eventResize={onEventResize}
                datesSet={onDatesSet}
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
