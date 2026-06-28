'use client';

import React, { forwardRef } from 'react';
import { alpha } from '@mui/material/styles';
import { Box, Chip, Paper } from '@/components/ui/mui';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg, DateSelectArg, EventDropArg, DatesSetArg, EventContentArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';

type HeaderToolbarConfig = {
    left?: string;
    center?: string;
    right?: string;
} | false;

type Props = {
    calendarRef?: React.Ref<FullCalendar>;
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

type ReportStatus = {
    id: string;
    status: string;
    is_primary: boolean;
};

export const ShiftCalendarViewer = forwardRef<FullCalendar, Props>(({
    calendarRef, events, initialView, headerToolbar, buttonText, selectable = false, editable = false,
    onEventClick, onDateSelect, onEventDrop, onEventResize, onDatesSet, noEventsText
}, ref) => {
    const renderEventContent = (arg: EventContentArg) => {
        const statuses = (arg.event.extendedProps.reportStatuses ?? []) as ReportStatus[];
        const staffNames = (arg.event.extendedProps.staffNames ?? '') as string;

        if (!arg.view.type.startsWith('list')) {
            return (
                <Box component="span" className="shift-calendar-event-content">
                    {arg.timeText && (
                        <Box component="span" className="shift-calendar-event-time">
                            {arg.timeText}
                        </Box>
                    )}
                    <Box component="span" className="shift-calendar-event-title">
                        {arg.event.title}
                    </Box>
                    {staffNames && (
                        <Box component="span" className="shift-calendar-event-staff">
                            {staffNames}
                        </Box>
                    )}
                </Box>
            );
        }

        return (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
                <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{arg.event.title}</Box>
                {statuses.length > 0 ? (
                    statuses.slice(0, 2).map((report) => (
                        <Chip
                            key={report.id}
                            label={getReportStatusLabel(report.status, '記録あり')}
                            color={getReportStatusChipColor(report.status)}
                            size="small"
                            variant={report.is_primary ? 'filled' : 'outlined'}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                    ))
                ) : (
                    <Chip label="未作成" color="default" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                )}
                {statuses.length > 2 && (
                    <Chip label={`+${statuses.length - 2}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                )}
            </Box>
        );
    };

    return (
        <Paper sx={(theme) => ({
            display: 'flex',
            flexDirection: 'column',
            height: { xs: '72vh', md: 'calc(100vh - 252px)' },
            minHeight: { xs: 540, md: 620 },
            borderRadius: 2,
            p: { xs: 1, sm: 1.5 },
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
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
            '& .fc-header-toolbar': {
                alignItems: 'center',
                gap: 1,
                marginBottom: '12px !important',
                flexWrap: 'wrap',
            },
            '& .fc-toolbar-chunk': {
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
            },
            '& .fc-button': {
                minHeight: 36,
                borderRadius: `${theme.shape.borderRadius}px !important`,
                px: '12px !important',
                textTransform: 'none',
                fontWeight: 700,
                boxShadow: 'none !important',
            },
            '& .fc-button-primary:not(:disabled).fc-button-active': {
                bgcolor: `${theme.palette.primary.dark} !important`,
                borderColor: `${theme.palette.primary.dark} !important`,
            },
            '& .fc-toolbar-title': { fontSize: '1.05rem', fontWeight: 700, color: theme.palette.text.primary },
            '& .fc-view-harness': {
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden',
                bgcolor: 'background.paper',
            },
            '& .fc-scrollgrid': { border: '0 !important' },
            '& .fc-col-header-cell': { bgcolor: 'background.subtle' },
            '& .fc-col-header-cell-cushion': {
                color: theme.palette.text.secondary,
                padding: '9px 0',
                fontSize: '0.82rem',
                fontWeight: 700,
            },
            '& .fc-daygrid-day-number': {
                color: theme.palette.text.primary,
                fontSize: '0.82rem',
                fontWeight: 600,
                padding: '7px 8px',
            },
            '& .fc-day-other .fc-daygrid-day-number': { color: theme.palette.text.disabled },
            '& .fc-daygrid-day.fc-day-today': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
            '& .fc-daygrid-day-frame': { minHeight: 96 },
            '& .fc-daygrid-event-harness': { marginInline: '5px' },
            '& .fc-daygrid-event.shift-calendar-event': {
                display: 'block',
                borderRadius: '6px',
                border: '1px solid transparent',
                padding: '3px 6px',
                marginTop: '3px',
                cursor: 'pointer',
                boxShadow: 'none',
                overflow: 'hidden',
            },
            '& .fc-daygrid-event.shift-calendar-event:hover': {
                filter: 'brightness(0.96)',
            },
            '& .fc-daygrid-event.shift-calendar-event.is-cancelled': {
                color: `${theme.palette.text.secondary} !important`,
                textDecoration: 'line-through',
            },
            '& .shift-calendar-event-content': {
                display: 'grid',
                gap: '1px',
                minWidth: 0,
                lineHeight: 1.25,
            },
            '& .shift-calendar-event-time': {
                fontSize: '0.68rem',
                fontWeight: 800,
                opacity: 0.92,
                whiteSpace: 'nowrap',
            },
            '& .shift-calendar-event-title': {
                fontSize: '0.76rem',
                fontWeight: 800,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            },
            '& .shift-calendar-event-staff': {
                fontSize: '0.67rem',
                fontWeight: 600,
                opacity: 0.82,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            },
            '& .fc-timegrid-event.shift-calendar-event': {
                borderRadius: '6px',
                padding: '4px 6px',
                boxShadow: 'none',
            },
            '& .fc-timegrid-slot': { height: 34 },
            '& .fc-list': { border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' },
            '& .fc-list-day-cushion': { backgroundColor: `${theme.palette.background.tint} !important`, color: theme.palette.primary.main, fontWeight: 700 },
            '& .fc-list-event:hover td': { backgroundColor: theme.palette.background.subtle, cursor: 'pointer' },
            '& .fc-list-event-title': { overflowWrap: 'anywhere' },
            '& .fc-event-dragging': { opacity: 0.8 },
            '& .fc-event-resizing': { opacity: 0.8 },
        })}>
            <FullCalendar
                ref={calendarRef ?? ref}
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
                eventContent={renderEventContent}
                eventClassNames={(arg) => [
                    'shift-calendar-event',
                    arg.event.extendedProps.isCancelled ? 'is-cancelled' : '',
                ].filter(Boolean)}
                eventDisplay="block"
                dayMaxEvents={true}
                expandRows={true}
                handleWindowResize={true}
                height="100%"
                noEventsText={noEventsText}
            />
        </Paper>
    );
});

ShiftCalendarViewer.displayName = 'ShiftCalendarViewer';
