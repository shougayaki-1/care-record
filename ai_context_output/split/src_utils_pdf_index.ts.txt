'use client';

import React from 'react';
import FullCalendar from '@fullcalendar/react';
import { downloadShiftSchedulePdf } from './shiftSchedulePdf';
import { downloadShiftCalendarPdf } from './shiftCalendarPdf';
import { downloadShiftMatrixPdfInternal } from './shiftMatrixPdf';
import { FetchedShiftData } from '@/utils/shiftHelper';

type HelperStaff = { id: string; name: string };
type HelperClient = { id: string; name: string };

interface DownloadPdfParams {
    calendarRef: React.RefObject<FullCalendar | null>;
    currentOrg: { name: string } | null;
    tabIndex: number;
    selectedStaffId: string;
    selectedClientId: string;
    staffs: HelperStaff[];
    clients: HelperClient[];
}

export async function downloadShiftPdf({
    calendarRef, currentOrg, tabIndex, selectedStaffId, selectedClientId, staffs, clients
}: DownloadPdfParams) {
    if (!calendarRef.current || !currentOrg) return;

    const api = calendarRef.current.getApi();
    const viewType = api.view.type;
    const monthStr = api.view.title;

    let entityName = '全体シフト';
    if (tabIndex === 2) entityName = '私のシフト';
    else if (tabIndex === 3) entityName = selectedStaffId !== 'all' ? `${staffs.find(s => s.id === selectedStaffId)?.name}様` : '全スタッフ';
    else if (tabIndex === 4) entityName = selectedClientId !== 'all' ? `${clients.find(c => c.id === selectedClientId)?.name}様` : '全利用者';

    const docTitle = `${entityName} シフト表`;
    const fileName = `${entityName}_シフト表_${monthStr.replace(/\s+/g, '')}.pdf`;

    if (viewType.includes('list')) {
        await downloadShiftSchedulePdf({ api, currentOrg, monthStr, docTitle, fileName });
    } else {
        await downloadShiftCalendarPdf({ api, currentOrg, monthStr, docTitle, fileName });
    }
}

interface DownloadMatrixParams {
    calendarRef: React.RefObject<FullCalendar | null>;
    currentOrg: { name: string } | null;
    rawShifts: FetchedShiftData[];
    staffs: HelperStaff[];
}

export async function downloadShiftMatrixPdf({
    calendarRef, currentOrg, rawShifts, staffs
}: DownloadMatrixParams) {
    if (!calendarRef.current || !currentOrg) return;

    const api = calendarRef.current.getApi();
    const currentMonthStart = api.view.currentStart;
    const year = currentMonthStart.getFullYear();
    const month = currentMonthStart.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthStr = `${year}年 ${month + 1}月`;

    const docTitle = `全体シフト表 (スタッフ横断)`;
    const fileName = `全体シフト表_${year}${String(month + 1).padStart(2, '0')}.pdf`;

    await downloadShiftMatrixPdfInternal({
        title: docTitle,
        monthStr,
        daysInMonth,
        rawShifts,
        staffs,
        currentOrg,
        fileName
    });
}