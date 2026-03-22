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
        user_id: string | null;
        ghost_staff_id: string | null;
        profiles: { name: string } | null;
        ghost_staffs: { name: string } | null;
    }[];
};

// UTCズレを防ぐローカルタイムの DTSTART 生成関数
export const getLocalDTSTART = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
};

// DBから取得したシフトデータを、FullCalendar用の EventInput 配列に変換する関数
export const convertToCalendarEvents = (shifts: FetchedShiftData[], isListView: boolean = false): EventInput[] => {
    return shifts.map((shift) => {
        const sDate = new Date(shift.start_at);
        const eDate = new Date(shift.end_at);
        const isCancelled = shift.status === 'cancelled';

        const diffMs = eDate.getTime() - sDate.getTime();
        const hours = Math.floor(diffMs / 3600000);
        const minutes = Math.floor((diffMs % 3600000) / 60000);
        const durationStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        const staffNames = shift.shift_staffs.map(s => s.profiles?.name || s.ghost_staffs?.name || '').filter(Boolean).join(', ');
        const displayTitle = isCancelled ? `【休】${shift.title}` : shift.title;

        const eventConfig: EventInput = {
            id: shift.id,
            title: displayTitle || '予定',
            // isListViewがtrue(リストやビュー)とfalse(管理画面)で背景色を調整可能
            backgroundColor: isCancelled ? (isListView ? 'transparent' : '#F2F3F5') : '#2255CC',
            borderColor: isCancelled ? (isListView ? 'transparent' : '#E3E5E8') : '#2255CC',
            textColor: isCancelled ? '#999' : '#ffffff',
            extendedProps: {
                shiftData: shift, // 管理画面用
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
            eventConfig.duration = durationStr;
        } else {
            eventConfig.start = shift.start_at;
            eventConfig.end = shift.end_at;
        }
        return eventConfig;
    });
};