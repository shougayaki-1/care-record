'use client';

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { ShiftScheduleDocument, PdfShiftData } from '@/components/pdf/ShiftScheduleDocument';
import { CalendarApi, EventApi } from '@fullcalendar/core';

interface Params {
    api: CalendarApi;
    currentOrg: { name: string };
    monthStr: string;
    docTitle: string;
    fileName: string;
}

export async function downloadShiftSchedulePdf({ api, currentOrg, monthStr, docTitle, fileName }: Params) {
    const renderedEvents = api.getEvents();
    const pdfShifts: PdfShiftData[] = [];
    const days = ['日', '月', '火', '水', '木', '金', '土'];

    renderedEvents.forEach((ev: EventApi) => {
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
                timestamp: start.getTime()
            });
        } else {
            pdfShifts.push({
                dateStr: `${start.getMonth() + 1}/${start.getDate()} (${days[start.getDay()]})`,
                startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                endTime: `24:00`,
                clientName: ev.extendedProps.clientName,
                staffNames: ev.extendedProps.staffNames,
                isCancelled: ev.extendedProps.isCancelled,
                timestamp: start.getTime()
            });
            pdfShifts.push({
                dateStr: `${end.getMonth() + 1}/${end.getDate()} (${days[end.getDay()]})`,
                startTime: `00:00`,
                endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                clientName: ev.extendedProps.clientName,
                staffNames: ev.extendedProps.staffNames,
                isCancelled: ev.extendedProps.isCancelled,
                timestamp: endZero.getTime()
            });
        }
    });

    pdfShifts.sort((a, b) => a.timestamp - b.timestamp);

    const blob = await pdf(
        <ShiftScheduleDocument 
            title={docTitle} 
            monthStr={monthStr} 
            shifts={pdfShifts} 
            orgName={currentOrg.name} 
        />
    ).toBlob();

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
}