import { EventInput } from '@fullcalendar/core';
import { brand, neutral } from '../styles/tokens';

export type FetchedShiftData = {
    id: string;
    organization_id: string;
    client_id: string;
    title: string | null;
    start_at: string;
    end_at: string;
    status: string;
    cancel_reason: string | null;
    clients: { id: string; name: string } | null;
    shift_staffs: {
        staff_id: string;
        staffs: { name: string } | null;
    }[];
};

export const convertToCalendarEvents = (shifts: FetchedShiftData[], isListView: boolean = false): EventInput[] => {
    return shifts.map((shift) => {
        const isCancelled = shift.status === 'cancelled';
        const staffNames = shift.shift_staffs.map(ss => ss.staffs?.name || '').filter(Boolean).join(', ');

        // ★修正: title（利用者名）に「様」がついていなければ付与する
        let rawTitle = shift.title || shift.clients?.name || '予定';
        // "(山田太郎)" などのカッコ表記が含まれるタイトルパターンの場合、名前部分に様をつける調整
        if (!rawTitle.includes('様')) {
            if (rawTitle.includes('(')) {
                rawTitle = rawTitle.replace(' (', ' 様 (');
            } else {
                rawTitle = `${rawTitle} 様`;
            }
        }
        
        const displayTitle = isCancelled ? `【休】${rawTitle}` : rawTitle;

        return {
            id: shift.id,
            title: displayTitle,
            start: shift.start_at,
            end: shift.end_at,
            backgroundColor: isCancelled ? (isListView ? 'transparent' : neutral.surface) : brand.primary,
            borderColor: isCancelled ? (isListView ? 'transparent' : neutral.border) : brand.primary,
            textColor: isCancelled ? '#999' : neutral.white,
            extendedProps: {
                shiftData: shift,
                shiftId: shift.id,
                clientId: shift.client_id,
                clientName: shift.clients?.name || '', // 内部データとしてはそのまま保持
                staffNames: staffNames,
                isCancelled: isCancelled
            }
        };
    });
};