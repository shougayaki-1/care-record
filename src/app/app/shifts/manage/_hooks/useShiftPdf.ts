'use client';

import { useState, useCallback } from 'react';
import { downloadShiftPdf, downloadShiftMatrixPdf } from '@/utils/shiftPdfHelper';
import { Workspace } from '@/context/WorkspaceContext';
import { ClientData, StaffData } from '@/types';
import { FetchedShiftData } from '@/utils/shiftHelper';
import FullCalendar from '@fullcalendar/react';

export function useShiftPdf(
    currentOrg: Workspace | null,
    staffs: StaffData[],
    clients: ClientData[]
) {
    const [pdfGenerating, setPdfGenerating] = useState(false);

    const handleDownloadPdf = useCallback(async (
        calendarRef: React.RefObject<FullCalendar | null>,
        tabIndex: number,
        selectedStaffId: string,
        selectedClientId: string,
        showToast: (msg: string, severity?: 'success' | 'error' | 'info' | 'warning') => void
    ) => {
        setPdfGenerating(true);
        try {
            await downloadShiftPdf({
                calendarRef, currentOrg, tabIndex, selectedStaffId, selectedClientId, staffs, clients
            });
        } catch (e) {
            console.error(e);
            showToast('PDFの作成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    }, [currentOrg, staffs, clients]);

    const handleDownloadMatrixPdf = useCallback(async (
        calendarRef: React.RefObject<FullCalendar | null>,
        rawShifts: FetchedShiftData[],
        showToast: (msg: string, severity?: 'success' | 'error' | 'info' | 'warning') => void
    ) => {
        setPdfGenerating(true);
        try {
            await downloadShiftMatrixPdf({
                calendarRef, currentOrg, rawShifts, staffs
            });
        } catch (e) {
            console.error(e);
            showToast('マトリックスPDFの作成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    }, [currentOrg, staffs]);

    return {
        pdfGenerating,
        handleDownloadPdf,
        handleDownloadMatrixPdf
    };
}