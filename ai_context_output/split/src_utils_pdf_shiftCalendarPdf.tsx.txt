'use client';

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { ShiftCalendarDocument, PdfCalendarEvent, PdfCalendarDay } from '@/components/pdf/ShiftCalendarDocument';
import { CalendarApi, EventApi } from '@fullcalendar/core';

interface Params {
    api: CalendarApi;
    currentOrg: { name: string };
    monthStr: string;
    docTitle: string;
    fileName: string;
}

export async function downloadShiftCalendarPdf({ api, currentOrg, monthStr, docTitle, fileName }: Params) {
    const renderedEvents = api.getEvents();
    const activeStart = api.view.activeStart;
    const activeEnd = api.view.activeEnd;
    const dayMap = new Map<string, PdfCalendarEvent[]>();

    renderedEvents.forEach((ev: EventApi) => {
        const start = new Date(ev.start!);
        const end = new Date(ev.end!);

        const startZero = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endZero = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        const diffTime = endZero.getTime() - startZero.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            const dateKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
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

                const dateKey = `${currentDay.getFullYear()}-${String(currentDay.getMonth() + 1).padStart(2, '0')}-${String(currentDay.getDate()).padStart(2, '0')}`;

                let timeDisplay = '';
                if (d === 0) {
                    timeDisplay = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}〜24:00`;
                } else if (d === diffDays) {
                    if (end.getHours() === 0 && end.getMinutes() === 0) {
                        continue;
                    }
                    timeDisplay = `00:00〜${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                } else {
                    timeDisplay = `終日`;
                }

                const eventObj: PdfCalendarEvent = {
                    timeStr: timeDisplay,
                    clientName: ev.extendedProps.clientName,
                    staffNames: ev.extendedProps.staffNames,
                    isCancelled: ev.extendedProps.isCancelled,
                };

                if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
                dayMap.get(dateKey)!.push(eventObj);
            }
        }
    });

    const weeks: PdfCalendarDay[][] = [];
    let currentWeek: PdfCalendarDay[] = [];
    const d = new Date(activeStart);

    while (d < activeEnd) {
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayEvents = dayMap.get(dateKey) || [];
        dayEvents.sort((a, b) => a.timeStr.localeCompare(b.timeStr));
        currentWeek.push({ date: new Date(d), dateStr: dateKey, dayNumber: d.getDate(), events: dayEvents });
        d.setDate(d.getDate() + 1);
        if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);

    const blob = await pdf(<ShiftCalendarDocument title={docTitle} monthStr={monthStr} weeks={weeks} orgName={currentOrg.name} />).toBlob();

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
}