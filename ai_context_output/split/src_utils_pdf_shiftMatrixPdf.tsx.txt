'use client';

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { ShiftMatrixDocument, MatrixStaffData } from '@/components/pdf/ShiftMatrixDocument';
import { FetchedShiftData } from '@/utils/shiftHelper';

interface Staff {
    id: string;
    name: string;
}

interface Params {
    title: string;
    monthStr: string;
    daysInMonth: number;
    rawShifts: FetchedShiftData[];
    staffs: Staff[];
    currentOrg: { name: string };
    fileName: string;
}

export async function downloadShiftMatrixPdfInternal({
    title, monthStr, daysInMonth, rawShifts, staffs, currentOrg, fileName
}: Params) {
    const matrixMap = new Map<string, MatrixStaffData>();
    staffs.forEach(s => matrixMap.set(s.id, { staffName: s.name, shiftsByDay: {} }));

    const year = parseInt(monthStr.split('年')[0].trim(), 10);
    const month = parseInt(monthStr.split('年')[1].replace('月', '').trim(), 10) - 1;

    rawShifts.forEach(shift => {
        if (shift.status === 'cancelled') return;
        const start = new Date(shift.start_at);
        if (start.getFullYear() !== year || start.getMonth() !== month) return;

        const day = start.getDate();
        const end = new Date(shift.end_at);

        const cName = shift.clients?.name || '不明';
        const displayName = cName.endsWith('様') ? cName.replace('様', '') : cName;
        const timeStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}-${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}\n${displayName}`;

        shift.shift_staffs.forEach((ss) => {
            const sData = matrixMap.get(ss.staff_id);
            if (sData) {
                if (!sData.shiftsByDay[day]) sData.shiftsByDay[day] = [];
                sData.shiftsByDay[day].push(timeStr);
            }
        });
    });

    const staffDataArray = Array.from(matrixMap.values()).sort((a, b) => a.staffName.localeCompare(b.staffName));

    const blob = await pdf(
        <ShiftMatrixDocument
            title={title}
            monthStr={monthStr}
            daysInMonth={daysInMonth}
            staffData={staffDataArray}
            orgName={currentOrg.name}
        />
    ).toBlob();

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
}