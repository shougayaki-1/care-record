'use client';
import { tokens } from '@/styles/tokens';

import React, { forwardRef } from 'react';
import { Paper } from '@mui/material';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg, DateSelectArg, EventDropArg } from '@fullcalendar/core';
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
    noEventsText?: string;
};

export const ShiftCalendarViewer = forwardRef<FullCalendar, Props>(({
    events, initialView, headerToolbar, buttonText, selectable = false, editable = false,
    onEventClick, onDateSelect, onEventDrop, onEventResize, noEventsText
}, ref) => {
    return (
        <Paper sx={{
            display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)',
            borderRadius: 3, p: 2, boxShadow: 'none', border: `1px solid ${tokens.neutral.border}`,
            '& .fc': {
                height: '100%',
                bgcolor: 'white',
                '--fc-button-bg-color': tokens.brand.primary,
                '--fc-button-border-color': tokens.brand.primary,
                '--fc-button-hover-bg-color': tokens.brand.primaryDark,
                '--fc-button-hover-border-color': tokens.brand.primaryDark,
                '--fc-button-active-bg-color': tokens.brand.primaryDark,
                '--fc-button-active-border-color': tokens.brand.primaryDark,
                '--fc-today-bg-color': tokens.blueTint[50],
                '--fc-border-color': tokens.neutral.border,
                '--fc-event-text-color': '#fff',
                fontFamily: 'inherit',
            },
            '& .fc-button': { textTransform: 'capitalize', borderRadius: '6px', fontWeight: 'bold', boxShadow: 'none !important' },
            '& .fc-toolbar-title': { fontSize: '1.25rem', fontWeight: 'bold', color: tokens.text.strong },
            '& .fc-col-header-cell-cushion': { color: tokens.text.muted, padding: '8px 0' },
            '& .fc-event-time': { fontWeight: 'bold', marginRight: '4px' },
            '& .fc-list-day-cushion': { backgroundColor: `${tokens.blueTint[50]} !important`, color: tokens.brand.primary, fontWeight: 'bold' },
            '& .fc-list-event:hover td': { backgroundColor: tokens.neutral.bg, cursor: 'pointer' },
            // ★ドラッグ＆ドロップ時のUI調整
            '& .fc-event-dragging': { opacity: 0.8 },
            '& .fc-event-resizing': { opacity: 0.8 },
        }}>
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