import { useState, type RefObject } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { downloadShiftPdf, downloadShiftMatrixPdf } from '@/utils/shiftPdfExport';
import type { ShiftManageTab, ShiftOperationFeedback } from '@/features/shifts/manageTypes';
import type { ClientData, StaffData, ShiftListItem } from '@/features/shifts/types';

type Options = Pick<ShiftOperationFeedback, 'showToast'> & {
    calendarRef: RefObject<FullCalendar | null>;
    currentOrg: { id: string; name: string } | null;
    activeTab: ShiftManageTab;
    staffs: StaffData[];
    clients: ClientData[];
    rawShifts: ShiftListItem[];
    selectedStaffId: string;
    selectedClientId: string;
};

/** The displayed PDF uses rendered events; the matrix uses the fetched shift rows. */
export function useShiftPdfExport({ calendarRef, currentOrg, activeTab, staffs, clients, rawShifts, selectedStaffId, selectedClientId, showToast }: Options) {
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const handleDownloadPdf = async () => {
        if (!calendarRef.current || !currentOrg) return;
        setPdfGenerating(true);
        try {
            await downloadShiftPdf({
                calendarApi: calendarRef.current.getApi(),
                currentOrg,
                activeTab,
                staffs,
                clients,
                selectedStaffId,
                selectedClientId,
            });
        } catch (error) {
            console.error(error);
            showToast('PDFの作成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    };

    const handleDownloadMatrixPdf = async () => {
        if (!calendarRef.current || !currentOrg) return;
        setPdfGenerating(true);
        try {
            await downloadShiftMatrixPdf({
                calendarApi: calendarRef.current.getApi(),
                currentOrg,
                staffs,
                rawShifts,
            });
        } catch (error) {
            console.error(error);
            showToast('全体マトリックスPDFの生成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    };

    return { pdfGenerating, handleDownloadPdf, handleDownloadMatrixPdf };
}
