import { EventInput } from '@fullcalendar/core';

export type FetchedShiftData = {
    id: string;
    organization_id: string;
    client_id: string;
    title: string | null;
    start_at: string;
    end_at: string;
    is_recurring: boolean;
    rrule: string | null;
    status: string;
    cancel_reason: string | null;
    clients: { id: string; name: string } | null;
    shift_staffs: {
        staff_id: string;
        staffs: { name: string } | null;
    }[];
};

export const getLocalDTSTART = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

export const convertToCalendarEvents = (shifts: FetchedShiftData[], isListView: boolean = false): EventInput[] => {
    return shifts.map((shift) => {
        const sDate = new Date(shift.start_at);
        const isCancelled = shift.status === 'cancelled';
        
        const staffNames = shift.shift_staffs.map(ss => ss.staffs?.name || '').filter(Boolean).join(', ');

        const eventConfig: EventInput = {
            id: shift.id,
            title: isCancelled ? `【休】${shift.title}` : (shift.title || '予定'),
            backgroundColor: isCancelled ? (isListView ? 'transparent' : '#F2F3F5') : '#2255CC',
            borderColor: isCancelled ? (isListView ? 'transparent' : '#E3E5E8') : '#2255CC',
            textColor: isCancelled ? '#999' : '#ffffff',
            extendedProps: {
                shiftData: shift,
                shiftId: shift.id,
                clientId: shift.client_id,
                clientName: shift.clients?.name || '',
                staffNames: staffNames,
                isCancelled: isCancelled
            }
        };

        if (shift.rrule) {
            const dtStart = getLocalDTSTART(sDate);
            eventConfig.rrule = `DTSTART:${dtStart}\nRRULE:${shift.rrule}`;
            const eDate = new Date(shift.end_at);
            const diffMs = eDate.getTime() - sDate.getTime();
            const hours = Math.floor(diffMs / 3600000);
            const minutes = Math.floor((diffMs % 3600000) / 60000);
            eventConfig.duration = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        } else {
            eventConfig.start = shift.start_at;
            eventConfig.end = shift.end_at;
        }
        return eventConfig;
    });
};