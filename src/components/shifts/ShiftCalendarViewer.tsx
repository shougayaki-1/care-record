'use client';

import React, { forwardRef } from 'react';
import { Box, Chip, Paper } from '@/components/ui/mui';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventClickArg, DateSelectArg, EventDropArg, DatesSetArg, EventContentArg } from '@fullcalendar/core';
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

const reportStatusLabel = (status: string): string => {
    if (status === 'draft') return '作成中';
    if (status === 'approved') return '承認済';
    if (status === 'remanded') return '差戻し';
    if (status === 'pending') return '提出済';
    return '記録あり';
};

const reportStatusColor = (status: string): 'default' | 'warning' | 'success' | 'error' | 'info' => {
    if (status === 'approved') return 'success';
    if (status === 'remanded') return 'error';
    if (status === 'pending') return 'info';
    if (status === 'draft') return 'warning';
    return 'default';
};

export const ShiftCalendarViewer = forwardRef<FullCalendar, Props>(({
    calendarRef, events, initialView, headerToolbar, buttonText, selectable = false, editable = false,
    onEventClick, onDateSelect, onEventDrop, onEventResize, onDatesSet, noEventsText
}, ref) => {
    const renderEventContent = (arg: EventContentArg) => {
        if (!arg.view.type.startsWith('list')) return undefined;
        const statuses = (arg.event.extendedProps.reportStatuses ?? []) as ReportStatus[];
        return (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
                <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{arg.event.title}</Box>
                {statuses.length > 0 ? (
                    statuses.slice(0, 2).map((report) => (
                        <Chip
                            key={report.id}
                            label={reportStatusLabel(report.status)}
                            color={reportStatusColor(report.status)}
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
                dayMaxEvents={true}
                noEventsText={noEventsText}
            />
        </Paper>
    );
});

ShiftCalendarViewer.displayName = 'ShiftCalendarViewer';
