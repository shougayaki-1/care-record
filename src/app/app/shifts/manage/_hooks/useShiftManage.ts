'use client';

import { useState, useRef, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { previewShiftsForMonth } from '@/app/actions/shiftGeneration';
import { ShiftPayload, ShiftPatternPayload, ShiftData, FetchedPatternData } from '@/types';
import { useShiftData } from './useShiftData';
import { useShiftCalendarSync } from './useShiftCalendarSync';
import { useShiftPdf } from './useShiftPdf';
import { useShiftFilters } from './useShiftFilters';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function useShiftManage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const { user: currentUser } = useCurrentUser();
    const currentUserId = currentUser?.id || '';
    const calendarRef = useRef<FullCalendar>(null);

    // 状態を Facade 親フックへリフトアップ
    const [syncProgress, setSyncProgress] = useState<{ total: number; current: number; currentName: string } | null>(null);
    const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
    const [generating, setGenerating] = useState(false);

    // Modals / Dialog states
    const [shiftModalOpen, setShiftModalOpen] = useState(false);
    const [patternModalOpen, setPatternModalOpen] = useState(false);
    const [clearDialogOpen, setClearDialogOpen] = useState(false);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

    const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);
    const [selectedPattern, setSelectedPattern] = useState<FetchedPatternData | null>(null);

    const [clearMode, setClearMode] = useState<'unmodified' | 'all'>('unmodified');
    const [previewDetails, setPreviewDetails] = useState<{ total: number; details: { title: string; count: number; isOvernight: boolean }[] } | null>(null);

    const dataModule = useShiftData(
        currentOrg,
        currentUserId,
        calendarRef,
        showToast,
        setSyncProgress,
        setUnsyncedCount
    );

    const syncModule = useShiftCalendarSync(
        currentOrg,
        syncProgress,
        setSyncProgress,
        unsyncedCount,
        setUnsyncedCount,
        generating,
        setGenerating,
        showToast,
        async (isBackground) => {
            await dataModule.fetchData(isBackground);
        }
    );

    const filterModule = useShiftFilters(
        currentOrg,
        dataModule.rawShifts,
        dataModule.currentStaffId,
        currentUserId
    );

    const pdfModule = useShiftPdf(
        currentOrg,
        dataModule.staffs,
        dataModule.clients
    );

    const handleOpenClearConfirm = () => {
        setClearMode('unmodified');
        setClearDialogOpen(true);
    };

    const handleCalculatePreview = async () => {
        if (!currentOrg) return;
        setGenerating(true);
        try {
            const res = await previewShiftsForMonth(currentOrg.id, filterModule.targetMonth);
            setPreviewDetails(res);
            setPreviewDialogOpen(true);
        } catch (e) {
            console.error(e);
            showToast('計算処理に失敗しました', 'error');
        } finally {
            setGenerating(false);
        }
    };

    const executeGenerateWithLocal = async () => {
        await syncModule.executeGenerate(filterModule.targetMonth, filterModule.setTabIndex);
    };

    const executeClearMonthShiftsWithLocal = async () => {
        await syncModule.executeClearMonthShifts(filterModule.targetMonth, clearMode);
    };

    const handleForceResyncCalendarWithLocal = async () => {
        await syncModule.handleForceResyncCalendar(dataModule.rawShifts);
    };

    const handleDownloadPdfWithLocal = async () => {
        await pdfModule.handleDownloadPdf(
            calendarRef,
            filterModule.tabIndex,
            filterModule.selectedStaffId,
            filterModule.selectedClientId,
            showToast
        );
    };

    const handleDownloadMatrixPdfWithLocal = async () => {
        await pdfModule.handleDownloadMatrixPdf(
            calendarRef,
            dataModule.rawShifts,
            showToast
        );
    };

    const isAdmin = ['owner', 'manager'].includes(currentOrg?.role || '');

    return {
        currentOrg,
        wsLoading,
        calendarRef,
        initialLoading: dataModule.initialLoading,
        isFetching: dataModule.isFetching,
        generating,
        pdfGenerating: pdfModule.pdfGenerating,
        rawShifts: dataModule.rawShifts,
        patterns: dataModule.patterns,
        events: filterModule.events,
        clients: dataModule.clients,
        staffs: dataModule.staffs,
        currentUserId,
        currentStaffId: dataModule.currentStaffId,
        tabIndex: filterModule.tabIndex,
        setTabIndex: filterModule.setTabIndex,
        selectedStaffId: filterModule.selectedStaffId,
        setSelectedStaffId: filterModule.setSelectedStaffId,
        selectedClientId: filterModule.selectedClientId,
        setSelectedClientId: filterModule.setSelectedClientId,
        targetMonth: filterModule.targetMonth,
        setTargetMonth: filterModule.setTargetMonth,
        shiftModalOpen,
        setShiftModalOpen,
        patternModalOpen,
        setPatternModalOpen,
        clearDialogOpen,
        setClearDialogOpen,
        previewDialogOpen,
        setPreviewDialogOpen,
        selectedShift,
        setSelectedShift,
        selectedPattern,
        setSelectedPattern,
        clearMode,
        setClearMode,
        previewDetails,
        syncProgress,
        unsyncedCount,
        repairingFromBanner: syncModule.repairingFromBanner, // 状態変数に正しくバインド
        resyncingCal: syncModule.resyncingCal,               // 状態変数に正しくバインド
        handleDownloadPdf: handleDownloadPdfWithLocal,
        handleDownloadMatrixPdf: handleDownloadMatrixPdfWithLocal,
        handleSaveShift: dataModule.handleSaveShift,
        handleToggleCancel: dataModule.handleToggleCancel,
        handleDeleteShift: dataModule.handleDeleteShift,
        handleEventChange: dataModule.handleEventChange,
        handleSavePattern: dataModule.handleSavePattern,
        handleOpenClearConfirm,
        executeClearMonthShifts: executeClearMonthShiftsWithLocal,
        handleDeletePattern: dataModule.handleDeletePattern,
        handleCalculatePreview,
        executeGenerate: executeGenerateWithLocal,
        handleRepairFromBanner: syncModule.handleRepairFromBanner,
        handleForceResyncCalendar: handleForceResyncCalendarWithLocal,
        isAdmin,
        showToast
    };
}