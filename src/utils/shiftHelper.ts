import { EventInput } from '@fullcalendar/core';

import type { ShiftListItem } from '@/features/shifts/types';

export const convertToCalendarEvents = (shifts: ShiftListItem[], isListView: boolean = false): EventInput[] => {
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
            backgroundColor: isCancelled ? (isListView ? 'transparent' : '#F2F3F5') : '#2255CC',
            borderColor: isCancelled ? (isListView ? 'transparent' : '#E3E5E8') : '#2255CC',
            textColor: isCancelled ? '#999' : '#ffffff',
            extendedProps: {
                shiftData: shift,
                shiftId: shift.id,
                clientId: shift.client_id,
                clientName: shift.clients?.name || '', // 内部データとしてはそのまま保持
                staffNames: staffNames,
                isCancelled: isCancelled,
                reportStatuses: shift.report_statuses ?? [],
            }
        };
    });
};
