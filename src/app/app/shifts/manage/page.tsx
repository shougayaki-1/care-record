'use client';

import React, { useEffect, useState, useRef, useCallback, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { Box, Typography, CircularProgress, Tabs, Tab, Button, Stack, LinearProgress, Alert } from '@/components/ui/mui';
import { CalendarPageSkeleton } from '@/components/ui';
import AddIcon from '@mui/icons-material/Add';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import BuildIcon from '@mui/icons-material/Build';
import SyncIcon from '@mui/icons-material/Sync';
import SettingsIcon from '@mui/icons-material/Settings';
import type FullCalendar from '@fullcalendar/react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import type { ShiftData, ShiftPatternData } from '@/features/shifts/types';
import { useShiftData, type ShiftDateRange } from '@/hooks/useShiftData';
import { ShiftFetchStatus } from '@/components/shifts/ShiftFetchStatus';
import { useSyncProgress } from '@/hooks/useSyncProgress';
import type { DatesSetArg } from '@fullcalendar/core';
import { checkManagementPermission, checkShiftPermission } from '@/utils/permissions';
import { buildRecordPath } from '@/utils/recordNavigation';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ShiftManageTab as TabId } from '@/features/shifts/manageTypes';
import { useShiftEditing } from '@/hooks/shifts/useShiftEditing';
import { useShiftMonthOperations } from '@/hooks/shifts/useShiftMonthOperations';
import { useShiftPdfExport } from '@/hooks/shifts/useShiftPdfExport';
import { ShiftPatternTable } from '@/components/shifts/manage/ShiftPatternTable';
import { ShiftMonthActions } from '@/components/shifts/manage/ShiftMonthActions';
import { ShiftMonthClearDialog, ShiftMonthPreviewDialog } from '@/components/shifts/manage/ShiftMonthDialogs';
import { ShiftManageFilters } from '@/components/shifts/manage/ShiftManageFilters';
import { ShiftSyncProgress } from '@/components/shifts/manage/ShiftSyncProgress';

const ShiftCalendarViewer = dynamic(
    () => import('@/components/shifts/ShiftCalendarViewer').then((mod) => mod.ShiftCalendarViewer),
    {
        ssr: false,
        loading: () => <CalendarPageSkeleton />,
    }
);

const ShiftFormModal = dynamic(
    () => import('@/components/shifts/ShiftFormModal').then((mod) => mod.ShiftFormModal),
    { ssr: false, loading: () => null }
);

const ShiftPatternModal = dynamic(
    () => import('@/components/shifts/ShiftPatternModal').then((mod) => mod.ShiftPatternModal),
    { ssr: false, loading: () => null }
);

export default function ShiftManagePage() {
    const { currentOrg, userId, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const router = useRouter();
    const searchParams = useSearchParams();
    // Page owns the calendar ref and URL deep-link lifecycle; operation hooks only consume the ref.
    const calendarRef = useRef<FullCalendar>(null);
    const handledShiftParamRef = useRef<string | null>(null);
    const calendarInitializedRef = useRef(false);
    const [isPending, startTransition] = useTransition();

    const [activeTab, setActiveTab] = useState<TabId>('fullCalendar');
    const [selectedStaffId, setSelectedStaffId] = useState('all');
    const [selectedClientId, setSelectedClientId] = useState('all');

    const [targetMonth, setTargetMonth] = useState<string>(() => {
        const monthParam = searchParams.get('month');
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) return monthParam;
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const [shiftModalOpen, setShiftModalOpen] = useState(false);
    const [patternModalOpen, setPatternModalOpen] = useState(false);

    const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);
    const [selectedPattern, setSelectedPattern] = useState<ShiftPatternData | null>(null);

    const {
        rawShifts, patterns, events, clients, staffs,
        currentStaffId, initialLoading, isFetching,
        unsyncedCount, unsyncedCountStatus, masterDataStatus, setUnsyncedCount,
        fetchData, fetchMasterData, fetchUnsyncedCount,
    } = useShiftData({ currentOrg, userId, showToast, calendarRef, activeTab, selectedStaffId, selectedClientId });

    const mastersReady = masterDataStatus === 'success';

    useEffect(() => {
        const shiftIdParam = searchParams.get('shiftId');
        const startParam = searchParams.get('start');
        if (!shiftIdParam || handledShiftParamRef.current === shiftIdParam) return;
        if (activeTab !== 'fullCalendar') {
            queueMicrotask(() => setActiveTab('fullCalendar'));
            return;
        }
        if (initialLoading) return;
        if (startParam && calendarRef.current) {
            calendarRef.current.getApi().gotoDate(new Date(startParam));
        }
    }, [activeTab, initialLoading, searchParams]);

    useEffect(() => {
        const shiftIdParam = searchParams.get('shiftId');
        if (!shiftIdParam || handledShiftParamRef.current === shiftIdParam) return;
        const targetShift = rawShifts.find((shift) => shift.id === shiftIdParam);
        if (!targetShift) return;
        queueMicrotask(() => {
            setSelectedShift(targetShift);
            setShiftModalOpen(true);
            handledShiftParamRef.current = shiftIdParam;
        });
    }, [rawShifts, searchParams]);

    const {
        syncProgress, setSyncProgress,
        repairingFromBanner, resyncingCal,
        runUnsyncedSyncLoop,
        handleRepairFromBanner, handleForceResyncCalendar,
    } = useSyncProgress({
        currentOrg,
        showToast,
        confirm,
        setUnsyncedCount,
        onDataRefresh: useCallback(() => fetchData(true), [fetchData]),
    });

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            queueMicrotask(() => void fetchMasterData());
            if (currentOrg.effectivePermissions.shifts.view !== 'all') router.replace('/app/shifts/my');
        }
    }, [wsLoading, currentOrg, fetchMasterData, router]);

    useEffect(() => {
        if (wsLoading || !currentOrg) return;
        const canUseOrgWideTabs = currentOrg.effectivePermissions.shifts.view === 'all';
        if (!canUseOrgWideTabs && (activeTab === 'fullCalendar' || activeTab === 'patterns')) return;
        fetchData(!initialLoading);
    }, [wsLoading, currentOrg, activeTab, selectedStaffId, selectedClientId, currentStaffId, masterDataStatus, fetchData, initialLoading]);

    const handleCalendarDatesSet = useCallback((info: DatesSetArg) => {
        if (activeTab === 'patterns') return;
        if (!calendarInitializedRef.current) {
            calendarInitializedRef.current = true;
            return; // Initial calendar render triggers this — let useEffect handle it
        }
        const range: ShiftDateRange = { start: info.start, end: info.end };
        fetchData(true, range);
    }, [activeTab, fetchData]);

    const { handleSaveShift, handleToggleCancel, handleDeleteShift, handleEventChange, handleSavePattern, handleDeletePattern } = useShiftEditing({
        mastersReady, showToast, confirm, setSyncProgress, onRefresh: () => fetchData(true),
    });
    const month = useShiftMonthOperations({
        currentOrg, targetMonth, mastersReady, showToast, onRefresh: () => fetchData(true),
        onGenerated: () => setActiveTab('fullCalendar'), runUnsyncedSyncLoop,
    });
    const { pdfGenerating, handleDownloadPdf, handleDownloadMatrixPdf } = useShiftPdfExport({
        calendarRef, currentOrg, activeTab, clients, staffs, rawShifts, selectedStaffId, selectedClientId, showToast,
    });

    const handleCreateRecord = (shift: ShiftData, segmentId?: string) => {
        if (shift.status === 'cancelled') {
            showToast('このシフトは現在キャンセル（お休み）されています。', 'info');
            return;
        }
        setShiftModalOpen(false);
        router.push(buildRecordPath(shift.client_id, { shiftId: shift.id, segmentId }));
    };

    const handleTabChange = useCallback((_: React.SyntheticEvent, value: TabId) => {
        if (value !== 'patterns' && activeTab === 'patterns') {
            calendarInitializedRef.current = false;
        }
        startTransition(() => setActiveTab(value));
    }, [activeTab, startTransition]);

    if (wsLoading || !currentOrg) return <CalendarPageSkeleton />;

    const canUseOrgWideTabs = currentOrg.effectivePermissions.shifts.view === 'all';
    const canCreateShift = checkShiftPermission(currentOrg.effectivePermissions, 'create', true);
    const canEditShift = checkShiftPermission(currentOrg.effectivePermissions, 'edit', true);
    const canDeleteShift = checkShiftPermission(currentOrg.effectivePermissions, 'delete', true);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 2, sm: 3 }, pt: 2, flexShrink: 0 }}>
                <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} flexDirection={{ xs: 'column', sm: 'row' }} gap={1} mb={1}>
                    <Typography variant="h6" fontWeight="bold">全体シフト管理</Typography>
                    {checkManagementPermission(currentOrg.effectivePermissions, 'organization') && <Button size="small" variant="text" startIcon={<SettingsIcon />} onClick={() => router.push('/app/settings?tab=rules')}>勤務・記録ルール</Button>}
                    {canCreateShift && activeTab === 'fullCalendar' && (
                        <Button disabled={!mastersReady} variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setShiftModalOpen(true); }} sx={{ boxShadow: 'none', alignSelf: { xs: 'stretch', sm: 'center' } }}>単発シフトを追加</Button>
                    )}
                    {canCreateShift && activeTab === 'patterns' && (
                        <Button disabled={!mastersReady} variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedPattern(null); setPatternModalOpen(true); }} sx={{ boxShadow: 'none', alignSelf: { xs: 'stretch', sm: 'center' } }}>ひな形を追加</Button>
                    )}
                </Box>
                <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
                    {canUseOrgWideTabs && <Tab label="基本パターン(ひな形)" value="patterns" />}
                    {canUseOrgWideTabs && <Tab label="全体カレンダー" value="fullCalendar" />}
                    <Tab label="スタッフ別" value="byStaff" />
                    <Tab label="利用者別" value="byClient" />
                </Tabs>
            </Box>

            <Box sx={{ position: 'relative', flexGrow: 1, p: { xs: 2, sm: 3 }, bgcolor: 'background.default', overflowY: 'auto' }}>
                {isPending && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 10 }} />}
                {isFetching && !initialLoading && (
                    <Box sx={{ position: 'absolute', top: 16, right: 30, zIndex: 10 }}>
                        <CircularProgress size={24} />
                    </Box>
                )}

                <ShiftFetchStatus
                    masterStatus={masterDataStatus}
                    countStatus={unsyncedCountStatus}
                    showCount={canEditShift && currentOrg.effectivePermissions.shifts.edit === 'all'}
                    onRetryMaster={() => void fetchMasterData()}
                    onRetryCount={() => void fetchUnsyncedCount()}
                />
                {initialLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                ) : (
                    <>
                        {unsyncedCountStatus === 'success' && unsyncedCount !== null && unsyncedCount > 0 && canEditShift && currentOrg.effectivePermissions.shifts.edit === 'all' && (
                            <Alert
                                severity="warning"
                                action={
                                    <Button
                                        color="warning"
                                        size="small"
                                        onClick={handleRepairFromBanner}
                                        disabled={repairingFromBanner}
                                        startIcon={repairingFromBanner ? <CircularProgress size={14} color="inherit" /> : <BuildIcon />}
                                    >
                                        {repairingFromBanner ? '修復中...' : '同期を修復する'}
                                    </Button>
                                }
                                sx={{ mb: 2, borderRadius: 1, boxShadow: 'none', border: '1px solid', borderColor: 'warning.light' }}
                            >
                                Googleカレンダーと同期されていない予定が <strong>{unsyncedCount} 件</strong> あります。前回の自動展開が途中で中断された場合はこちらから同期を再開できます。
                            </Alert>
                        )}

                        {activeTab !== 'patterns' && (
                            <ShiftManageFilters activeTab={activeTab} selectedStaffId={selectedStaffId} selectedClientId={selectedClientId}
                                staffs={staffs} clients={clients} onStaffChange={setSelectedStaffId} onClientChange={setSelectedClientId}>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent={{ xs: 'stretch', sm: 'flex-end' }} sx={{ ml: { sm: 'auto' }, width: { xs: '100%', sm: 'auto' }, '& > *': { flex: { xs: '1 1 100%', sm: '0 0 auto' } } }}>
                                    {canEditShift && currentOrg.effectivePermissions.shifts.edit === 'all' && (
                                        <Button
                                            variant="outlined"
                                            color="primary"
                                            startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
                                            onClick={handleForceResyncCalendar}
                                            disabled={resyncingCal || pdfGenerating}
                                            sx={{ bgcolor: 'background.paper' }}
                                        >
                                            {resyncingCal ? '再同期中...' : 'Googleカレンダー全件再同期'}
                                        </Button>
                                    )}
                                    {activeTab === 'byStaff' && selectedStaffId === 'all' && (
                                        <Button variant="outlined" color="primary" startIcon={<GridOnIcon />} onClick={handleDownloadMatrixPdf} disabled={pdfGenerating || resyncingCal} sx={{ bgcolor: 'background.paper' }}>
                                            {pdfGenerating ? '作成中...' : '全体マトリックスPDF'}
                                        </Button>
                                    )}
                                    <Button variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleDownloadPdf} disabled={pdfGenerating || resyncingCal} sx={{ bgcolor: 'background.paper' }}>
                                        {pdfGenerating ? '作成中...' : '表示中の形式でPDF出力'}
                                    </Button>
                                </Stack>
                            </ShiftManageFilters>
                        )}

                        {canUseOrgWideTabs && (
                            <Box sx={{ display: activeTab === 'patterns' ? 'block' : 'none' }}>
                                <ShiftMonthActions targetMonth={targetMonth} onMonthChange={setTargetMonth}
                                    canGenerate={mastersReady && canCreateShift && currentOrg.effectivePermissions.shifts.create === 'all'}
                                    canClear={canDeleteShift && currentOrg.effectivePermissions.shifts.delete === 'all'}
                                    generating={month.generating} patternCount={patterns.length} onPreview={month.handleCalculatePreview} onClear={month.openClear} />

                                <ShiftPatternTable patterns={patterns} mastersReady={mastersReady} canEditShift={canEditShift} canDeleteShift={canDeleteShift}
                                    onEdit={pattern => { setSelectedPattern(pattern); setPatternModalOpen(true); }} onDelete={handleDeletePattern} />
                            </Box>
                        )}

                        {activeTab !== 'patterns' && (
                            <Box sx={{ height: '100%' }}>
                                <ShiftCalendarViewer
                                    calendarRef={calendarRef}
                                    events={events}
                                    initialView={activeTab === 'myShift' ? 'listMonth' : 'dayGridMonth'}
                                    headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth' }}
                                    buttonText={{ listMonth: 'リスト', dayGridMonth: '月間', timeGridWeek: '週間' }}
                                    selectable={mastersReady && activeTab === 'fullCalendar' && canCreateShift}
                                    editable={mastersReady && activeTab === 'fullCalendar' && canEditShift}
                                    onEventDrop={handleEventChange}
                                    onEventResize={handleEventChange}
                                    onDatesSet={handleCalendarDatesSet}
                                    onDateSelect={(info) => {
                                        if (!mastersReady || activeTab !== 'fullCalendar' || !canCreateShift) return;
                                        setSelectedShift({
                                            id: '', client_id: '', title: '', start_at: info.startStr, end_at: info.endStr,
                                            status: 'published', cancel_reason: '', shift_staffs: []
                                        });
                                        setShiftModalOpen(true);
                                    }}
                                    onEventClick={(info) => {
                                        const { shiftData } = info.event.extendedProps;
                                        if (!shiftData) return;
                                        setSelectedShift(shiftData);
                                        setShiftModalOpen(true);
                                    }}
                                />
                            </Box>
                        )}
                    </>
                )}
            </Box>

            <ShiftSyncProgress syncProgress={month.syncProgress ?? syncProgress} />

            <ShiftFormModal
                open={shiftModalOpen}
                onClose={() => setShiftModalOpen(false)}
                onSave={handleSaveShift}
                onToggleCancel={canEditShift ? handleToggleCancel : undefined}
                onDelete={canDeleteShift ? handleDeleteShift : undefined}
                onCreateRecord={handleCreateRecord}
                clients={clients}
                staffs={staffs}
                organizationId={currentOrg.id}
                initialData={selectedShift}
                canSave={mastersReady && (selectedShift?.id ? canEditShift : canCreateShift)}
            />

            <ShiftPatternModal
                key={selectedPattern?.id ?? 'new_pattern'}
                open={patternModalOpen && mastersReady}
                onClose={() => setPatternModalOpen(false)}
                onSave={handleSavePattern}
                clients={clients}
                staffs={staffs}
                organizationId={currentOrg.id}
                initialData={selectedPattern}
            />

            <ShiftMonthClearDialog open={month.clearDialogOpen} targetMonth={targetMonth} clearMode={month.clearMode}
                onModeChange={month.setClearMode} onClose={month.closeClear} onConfirm={month.executeClearMonthShifts} />
            <ShiftMonthPreviewDialog open={month.previewDialogOpen} targetMonth={targetMonth} previewDetails={month.previewDetails} mastersReady={mastersReady}
                onClose={month.closePreview} onConfirm={month.executeGenerate} />
        </Box>
    );
}
