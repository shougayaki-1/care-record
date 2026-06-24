import React from 'react';
import { pdf } from '@react-pdf/renderer';
import type { CalendarApi } from '@fullcalendar/core';
import { supabase } from '@/lib/supabase';
import { FetchedShiftData } from './shiftHelper';
import { ClientData, StaffData } from '@/components/shifts/ShiftFormModal';
import { ShiftScheduleDocument, PdfShiftData } from '@/components/pdf/ShiftScheduleDocument';
import { ShiftCalendarDocument, PdfCalendarEvent, PdfCalendarDay } from '@/components/pdf/ShiftCalendarDocument';
import { ShiftMatrixDocument, MatrixStaffData } from '@/components/pdf/ShiftMatrixDocument';

type TabId = 'patterns' | 'fullCalendar' | 'myShift' | 'byStaff' | 'byClient';

export type DownloadShiftPdfOptions = {
    calendarApi: CalendarApi;
    currentOrg: { id: string; name: string };
    activeTab: TabId;
    staffs: StaffData[];
    clients: ClientData[];
    selectedStaffId: string;
    selectedClientId: string;
};

export const downloadShiftPdf = async ({
    calendarApi,
    currentOrg,
    activeTab,
    staffs,
    clients,
    selectedStaffId,
    selectedClientId,
}: DownloadShiftPdfOptions): Promise<void> => {
    const renderedEvents = calendarApi.getEvents();
    const viewType = calendarApi.view.type;
    const monthStr = calendarApi.view.title;

    let entityName = '全体シフト';
    if (activeTab === 'myShift') entityName = '私のシフト';
    else if (activeTab === 'byStaff') entityName = selectedStaffId !== 'all' ? `${staffs.find(s => s.id === selectedStaffId)?.name}様` : '全スタッフ';
    else if (activeTab === 'byClient') entityName = selectedClientId !== 'all' ? `${clients.find(c => c.id === selectedClientId)?.name}様` : '全利用者';

    const docTitle = `${entityName} シフト表`;
    const fileName = `${entityName}_シフト表_${monthStr.replace(/\s+/g, '')}.pdf`;

    const { data: staffRows } = await supabase
        .from('staffs')
        .select('name, employment_type, work_style')
        .eq('organization_id', currentOrg.id)
        .is('archived_at', null)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
    const staffMembers = (staffRows || []).map(s => ({
        name: s.name as string,
        employmentType: s.employment_type as string | null,
        workStyle: s.work_style as string | null,
    }));

    let blob: Blob;
    const days = ['日', '月', '火', '水', '木', '金', '土'];

    if (viewType.includes('list')) {
        const pdfShifts: PdfShiftData[] = [];
        renderedEvents.forEach(ev => {
            const start = ev.start!;
            const end = ev.end!;
            const startZero = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            const endZero = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            const diffDays = Math.floor((endZero.getTime() - startZero.getTime()) / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                pdfShifts.push({
                    dateStr: `${start.getMonth() + 1}/${start.getDate()} (${days[start.getDay()]})`,
                    startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                    endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                    clientName: ev.extendedProps.clientName,
                    staffNames: ev.extendedProps.staffNames,
                    isCancelled: ev.extendedProps.isCancelled,
                    timestamp: start.getTime(),
                });
            } else {
                pdfShifts.push({
                    dateStr: `${start.getMonth() + 1}/${start.getDate()} (${days[start.getDay()]})`,
                    startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                    endTime: '24:00',
                    clientName: ev.extendedProps.clientName,
                    staffNames: ev.extendedProps.staffNames,
                    isCancelled: ev.extendedProps.isCancelled,
                    timestamp: start.getTime(),
                });
                pdfShifts.push({
                    dateStr: `${end.getMonth() + 1}/${end.getDate()} (${days[end.getDay()]})`,
                    startTime: '00:00',
                    endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                    clientName: ev.extendedProps.clientName,
                    staffNames: ev.extendedProps.staffNames,
                    isCancelled: ev.extendedProps.isCancelled,
                    timestamp: endZero.getTime(),
                });
            }
        });
        pdfShifts.sort((a, b) => a.timestamp - b.timestamp);
        blob = await pdf(React.createElement(ShiftScheduleDocument, { title: docTitle, monthStr, shifts: pdfShifts, orgName: currentOrg.name, staffMembers })).toBlob();
    } else {
        const activeStart = calendarApi.view.activeStart;
        const activeEnd = calendarApi.view.activeEnd;
        const dayMap = new Map<string, PdfCalendarEvent[]>();

        renderedEvents.forEach(ev => {
            const start = new Date(ev.start!);
            const end = new Date(ev.end!);
            const startZero = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            const endZero = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            const diffDays = Math.floor((endZero.getTime() - startZero.getTime()) / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                const dateKey = toDateKey(start);
                const eventObj: PdfCalendarEvent = {
                    timeStr: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}〜${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                    clientName: ev.extendedProps.clientName,
                    staffNames: ev.extendedProps.staffNames,
                    isCancelled: ev.extendedProps.isCancelled,
                };
                if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
                dayMap.get(dateKey)!.push(eventObj);
            } else {
                for (let d = 0; d <= diffDays; d++) {
                    const currentDay = new Date(startZero);
                    currentDay.setDate(startZero.getDate() + d);
                    const dateKey = toDateKey(currentDay);

                    let timeDisplay = '';
                    if (d === 0) {
                        timeDisplay = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}〜24:00`;
                    } else if (d === diffDays) {
                        if (end.getHours() === 0 && end.getMinutes() === 0) continue;
                        timeDisplay = `00:00〜${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                    } else {
                        timeDisplay = '終日';
                    }

                    if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
                    dayMap.get(dateKey)!.push({
                        timeStr: timeDisplay,
                        clientName: ev.extendedProps.clientName,
                        staffNames: ev.extendedProps.staffNames,
                        isCancelled: ev.extendedProps.isCancelled,
                    });
                }
            }
        });

        const weeks: PdfCalendarDay[][] = [];
        let currentWeek: PdfCalendarDay[] = [];
        const d = new Date(activeStart);
        while (d < activeEnd) {
            const dateKey = toDateKey(d);
            const dayEvents = (dayMap.get(dateKey) || []).sort((a, b) => a.timeStr.localeCompare(b.timeStr));
            currentWeek.push({ date: new Date(d), dateStr: dateKey, dayNumber: d.getDate(), events: dayEvents });
            d.setDate(d.getDate() + 1);
            if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
        }
        if (currentWeek.length > 0) weeks.push(currentWeek);

        blob = await pdf(React.createElement(ShiftCalendarDocument, { title: docTitle, monthStr, weeks, orgName: currentOrg.name, staffMembers })).toBlob();
    }

    triggerDownload(blob, fileName);
};

export type DownloadShiftMatrixPdfOptions = {
    calendarApi: CalendarApi;
    currentOrg: { id: string; name: string };
    staffs: StaffData[];
    rawShifts: FetchedShiftData[];
};

export const downloadShiftMatrixPdf = async ({
    calendarApi,
    currentOrg,
    staffs,
    rawShifts,
}: DownloadShiftMatrixPdfOptions): Promise<void> => {
    const currentMonthStart = calendarApi.view.currentStart;
    const year = currentMonthStart.getFullYear();
    const month = currentMonthStart.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthStr = `${year}年 ${month + 1}月`;

    const docTitle = '全体シフト表 (スタッフ横断)';
    const fileName = `全体シフト表_${year}${String(month + 1).padStart(2, '0')}.pdf`;

    const matrixMap = new Map<string, MatrixStaffData>();
    staffs.forEach(s => matrixMap.set(s.id, { staffName: s.name, shiftsByDay: {} }));

    rawShifts.forEach(shift => {
        if (shift.status === 'cancelled') return;
        const start = new Date(shift.start_at);
        if (start.getFullYear() !== year || start.getMonth() !== month) return;

        const day = start.getDate();
        const end = new Date(shift.end_at);
        const cName = shift.clients?.name || '不明';
        const displayName = cName.endsWith('様') ? cName.replace('様', '') : cName;
        const timeStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}-${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}\n${displayName}`;

        shift.shift_staffs.forEach(ss => {
            const sData = matrixMap.get(ss.staff_id);
            if (sData) {
                if (!sData.shiftsByDay[day]) sData.shiftsByDay[day] = [];
                sData.shiftsByDay[day].push(timeStr);
            }
        });
    });

    const staffDataArray = Array.from(matrixMap.values());

    const { data: staffRows } = await supabase
        .from('staffs')
        .select('name, employment_type, work_style')
        .eq('organization_id', currentOrg.id)
        .is('archived_at', null)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
    const staffMembers = (staffRows || []).map(s => ({
        name: s.name as string,
        employmentType: s.employment_type as string | null,
        workStyle: s.work_style as string | null,
    }));

    const blob = await pdf(React.createElement(ShiftMatrixDocument, {
        title: docTitle,
        monthStr,
        daysInMonth,
        staffData: staffDataArray,
        orgName: currentOrg.name,
        staffMembers,
    })).toBlob();

    triggerDownload(blob, fileName);
};

const toDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
};
