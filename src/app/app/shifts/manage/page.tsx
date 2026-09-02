'use client';

import React, { useEffect, useState, useRef, useCallback, useTransition } from 'react';
import dynamic from 'next/dynamic';
import {
    Box, Typography, CircularProgress, Tabs, Tab, Button, Chip, IconButton, Tooltip, Stack, TextField,
    FormControlLabel, Radio, RadioGroup, LinearProgress,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, MenuItem, Alert
} from '@/components/ui/mui';
import { AppButton, AppDialog, CalendarPageSkeleton, MonthField } from '@/components/ui';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import BuildIcon from '@mui/icons-material/Build';
import SyncIcon from '@mui/icons-material/Sync';
import type FullCalendar from '@fullcalendar/react';
import type { EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import {
    createShift, updateShift, toggleCancelShift, updateShiftTimeOnly, deleteShiftCompletely,
    ShiftPayload, createShiftPattern, deleteShiftPattern, updateShiftPattern,
    generateShiftsForMonth, previewShiftsForMonth, ShiftPatternPayload,
    deleteShiftsBatch
} from '@/app/actions/shift';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import type { ShiftData } from '@/components/shifts/ShiftFormModal';
import { useShiftData, type ShiftDateRange } from '@/hooks/useShiftData';
import { useSyncProgress } from '@/hooks/useSyncProgress';
import { downloadShiftPdf, downloadShiftMatrixPdf } from '@/utils/shiftPdfExport';
import type { DatesSetArg } from '@fullcalendar/core';
import { checkShiftPermission } from '@/utils/permissions';
import { buildRecordPath } from '@/utils/recordNavigation';
import { useRouter, useSearchParams } from 'next/navigation';

import type { FetchedPatternData } from '@/hooks/useShiftData';

type TabId = 'patterns' | 'fullCalendar' | 'myShift' | 'byStaff' | 'byClient';

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
    const calendarRef = useRef<FullCalendar>(null);
    const handledShiftParamRef = useRef<string | null>(null);
    const calendarInitializedRef = useRef(false);
    const [isPending, startTransition] = useTransition();

    const [generating, setGenerating] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);

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
    const [clearDialogOpen, setClearDialogOpen] = useState(false);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

    const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);
    const [selectedPattern, setSelectedPattern] = useState<FetchedPatternData | null>(null);
    const [clearMode, setClearMode] = useState<'unmodified' | 'all'>('unmodified');
    const [previewDetails, setPreviewDetails] = useState<{ total: number; details: { title: string; count: number; isOvernight: boolean }[] } | null>(null);

    const {
        rawShifts, patterns, events, clients, staffs,
        currentStaffId, initialLoading, isFetching,
        unsyncedCount, setUnsyncedCount,
        fetchData, fetchMasterData,
    } = useShiftData({ currentOrg, userId, showToast, calendarRef, activeTab, selectedStaffId, selectedClientId });

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
            const canUseOrgWideTabs = currentOrg.effectivePermissions.shifts.view === 'all';
            if (!canUseOrgWideTabs && (activeTab === 'fullCalendar' || activeTab === 'patterns')) {
                queueMicrotask(() => setActiveTab('myShift'));
            }
        }
    }, [wsLoading, currentOrg, fetchMasterData, activeTab]);

    useEffect(() => {
        if (wsLoading || !currentOrg) return;
        const canUseOrgWideTabs = currentOrg.effectivePermissions.shifts.view === 'all';
        if (!canUseOrgWideTabs && (activeTab === 'fullCalendar' || activeTab === 'patterns')) return;
        fetchData(!initialLoading);
    }, [wsLoading, currentOrg, activeTab, selectedStaffId, selectedClientId, currentStaffId, fetchData, initialLoading]);

    const handleCalendarDatesSet = useCallback((info: DatesSetArg) => {
        if (activeTab === 'patterns') return;
        if (!calendarInitializedRef.current) {
            calendarInitializedRef.current = true;
            return; // Initial calendar render triggers this — let useEffect handle it
        }
        const range: ShiftDateRange = { start: info.start, end: info.end };
        fetchData(true, range);
    }, [activeTab, fetchData]);

    const handleSaveShift = async (payload: ShiftPayload, shiftId?: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: shiftId ? 'Googleカレンダーの予定を更新中...' : 'Googleカレンダーへ新規登録中...' });
        try {
            if (shiftId) await updateShift(shiftId, payload);
            else await createShift(payload);
            showToast('シフト情報を保存しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    };

    const handleToggleCancel = async (shiftId: string, isCancel: boolean, reason: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: isCancel ? '予定をお休みに設定＆Google同期中...' : '予定を通常復元＆Google同期中...' });
        try {
            await toggleCancelShift(shiftId, isCancel, reason);
            showToast(isCancel ? 'シフトをお休みに設定しました' : '通常予定に復元しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('変更に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    };

    const handleDeleteShift = async (shiftId: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: 'Googleカレンダーから予定を削除中...' });
        try {
            const result = await deleteShiftCompletely(shiftId);
            if (result.googleSync.status === 'failed') {
                showToast('シフトはDBから削除しましたが、Googleカレンダーの削除に失敗しました。設定画面から再試行してください。', 'warning');
            } else if (result.googleSync.status === 'pending') {
                showToast('シフトはDBから削除しました。Googleカレンダーの削除待ちです。設定画面から同期できます。', 'warning');
            } else {
                showToast('シフトをDBとGoogleカレンダーから削除しました');
            }
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    };

    const handleEventChange = async (info: EventDropArg | EventResizeDoneArg) => {
        const shiftId = info.event.extendedProps.shiftId;
        const start = info.event.start?.toISOString() || '';
        const end = info.event.end ? info.event.end.toISOString() : new Date(info.event.start!.getTime() + 3600000).toISOString();

        setSyncProgress({ total: 1, current: 0, currentName: '予定時間を更新＆Google同期中...' });
        try {
            await updateShiftTimeOnly(shiftId, start, end);
            showToast('シフト時間を調整しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            info.revert();
            showToast('変更に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    };

    const handleCreateRecord = (shift: ShiftData, segmentId?: string) => {
        if (shift.status === 'cancelled') {
            showToast('このシフトは現在キャンセル（お休み）されています。', 'info');
            return;
        }
        setShiftModalOpen(false);
        router.push(buildRecordPath(shift.client_id, { shiftId: shift.id, segmentId }));
    };

    const handleSavePattern = async (payload: ShiftPatternPayload, patternId?: string) => {
        try {
            if (patternId) {
                await updateShiftPattern(patternId, payload);
                showToast('ひな形情報を更新しました');
            } else {
                await createShiftPattern(payload);
                showToast('新規ひな形を登録しました');
            }
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('保存に失敗しました', 'error');
        }
    };

    const handleDeletePattern = async (id: string) => {
        if (!(await confirm({ title: 'ひな形の削除', message: 'このひな形を削除しますか？\n（※すでに展開済みのカレンダー上のシフト実体は削除されません）', confirmText: '削除する', confirmColor: 'error' }))) return;
        try {
            await deleteShiftPattern(id);
            showToast('ひな形を削除しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('削除に失敗しました', 'error');
        }
    };

    const handleCalculatePreview = async () => {
        if (!currentOrg) return;
        setGenerating(true);
        try {
            const res = await previewShiftsForMonth(currentOrg.id, targetMonth);
            setPreviewDetails(res);
            setPreviewDialogOpen(true);
        } catch (e) {
            console.error(e);
            showToast('計算処理に失敗しました', 'error');
        } finally {
            setGenerating(false);
        }
    };

    const executeGenerate = async () => {
        if (!currentOrg) return;
        setPreviewDialogOpen(false);
        setGenerating(true);
        try {
            const res = await generateShiftsForMonth(currentOrg.id, targetMonth);
            setGenerating(false);
            setActiveTab('fullCalendar');
            const resultSummary = `新規${res.count}件 / 更新${res.updated}件 / 編集済みスキップ${res.skipped}件 / 失敗${res.failed}件`;
            if (res.failed > 0) {
                showToast(
                    `${resultSummary}。ひな形が削除済みのスタッフ・サービス種別を参照している可能性があります。`,
                    'warning',
                );
            } else {
                showToast(`${resultSummary}。続けてGoogleカレンダーへ同期します。`, 'success');
            }
            fetchData(true);
            await runUnsyncedSyncLoop();
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('シフトの自動展開に失敗しました。', 'error');
            setGenerating(false);
        }
    };

    const executeClearMonthShifts = async () => {
        if (!currentOrg) return;
        setClearDialogOpen(false);
        setGenerating(true);

        try {
            const [year, month] = targetMonth.split('-').map(Number);
            const lastDayNum = new Date(year, month, 0).getDate();
            const pad = (n: number) => String(n).padStart(2, '0');
            const startDateISO = new Date(`${year}-${pad(month)}-01T00:00:00+09:00`).toISOString();
            const endDateISO = new Date(`${year}-${pad(month)}-${pad(lastDayNum)}T23:59:59+09:00`).toISOString();

            let query = supabase.from('shifts')
                .select('id, title')
                .eq('organization_id', currentOrg.id)
                .not('pattern_id', 'is', null)
                .or(`and(start_at.gte.${startDateISO},start_at.lte.${endDateISO})`);
            if (clearMode === 'unmodified') query = query.eq('is_modified', false);

            const { data: targetShifts, error: queryError } = await query;
            if (queryError) throw queryError;

            if (!targetShifts || targetShifts.length === 0) {
                showToast(`${targetMonth}月に消去対象の予定はありませんでした。`, 'info');
                setGenerating(false);
                return;
            }

            setGenerating(false);
            const total = targetShifts.length;
            setSyncProgress({ total, current: 0, currentName: '一括消去を開始中...' });

            const shiftIds = targetShifts.map(s => s.id);
            const CHUNK = 20;
            let deleted = 0, failed = 0, pending = 0, processed = 0;
            let errorKind: string | undefined;

            for (let i = 0; i < shiftIds.length; i += CHUNK) {
                const chunk = shiftIds.slice(i, i + CHUNK);
                const res = await deleteShiftsBatch(currentOrg.id, chunk);
                deleted += res.deleted;
                failed += res.failed;
                processed += res.deleted + (res.alreadyDeleted ?? 0) + res.failed;
                if (res.pending) pending += res.deleted + (res.alreadyDeleted ?? 0);
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, processed), currentName: `${Math.min(total, processed)} / ${total} 件 処理済み` });
                if (errorKind === 'auth') break;
            }

            setSyncProgress(null);

            if (errorKind === 'auth') {
                showToast('Googleカレンダーの認証が切れています。設定画面から再接続後にもう一度お試しください。', 'error');
            } else if (failed > 0) {
                showToast(`${deleted} 件を消去しました。${failed} 件はGoogleカレンダーから削除できず残っています。通信状況を確認し再度お試しください。`, 'warning');
            } else if (pending > 0) {
                showToast(`${deleted} 件をDBから消去しました。${pending} 件はGoogleカレンダーの削除待ちです。設定画面から同期できます。`, 'warning');
            } else {
                showToast(`${targetMonth}月のシフトを ${deleted} 件、Googleカレンダーを含めて消去しました。`, 'success');
            }
            fetchData(true);
        } catch (error) {
            console.error('Clear Deployed Shifts Error:', error);
            showToast('消去処理中にエラーが発生しました。', 'error');
            setGenerating(false);
            setSyncProgress(null);
        }
    };

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

    const formatRule = (rrule: string) => {
        let desc = '';
        if (rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
        else if (rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';

        const intervalMatch = rrule.match(/INTERVAL=([0-9]+)/);
        if (intervalMatch && intervalMatch[1] !== '1') {
            const unit = rrule.includes('FREQ=MONTHLY') ? 'ヶ月' : '週間';
            desc = `${intervalMatch[1]}${unit}に1回 `;
        }

        const daysMap: Record<string, string> = { 'MO': '月', 'TU': '火', 'WE': '水', 'TH': '木', 'FR': '金', 'SA': '土', 'SU': '日' };
        const match = rrule.match(/BYDAY=([^;]+)/);
        if (match) {
            const days = match[1].split(',').map(d => {
                const num = d.replace(/[A-Z]/g, '');
                const day = d.replace(/[0-9]/g, '');
                return (num ? `第${num}` : '') + (daysMap[day] || '');
            });
            desc += days.join(', ');
        }
        return desc;
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
                    {canCreateShift && activeTab === 'fullCalendar' && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setShiftModalOpen(true); }} sx={{ boxShadow: 'none', alignSelf: { xs: 'stretch', sm: 'center' } }}>単発シフトを追加</Button>
                    )}
                    {canCreateShift && activeTab === 'patterns' && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedPattern(null); setPatternModalOpen(true); }} sx={{ boxShadow: 'none', alignSelf: { xs: 'stretch', sm: 'center' } }}>ひな形を追加</Button>
                    )}
                </Box>
                <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
                    {canUseOrgWideTabs && <Tab label="基本パターン(ひな形)" value="patterns" />}
                    {canUseOrgWideTabs && <Tab label="全体カレンダー" value="fullCalendar" />}
                    <Tab label="自分のシフト" value="myShift" />
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

                {initialLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                ) : (
                    <>
                        {unsyncedCount > 0 && canEditShift && currentOrg.effectivePermissions.shifts.edit === 'all' && (
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
                            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={2} spacing={2}>
                                <Box flexGrow={1} width="100%">
                                    {activeTab === 'byStaff' && (
                                        <TextField select size="small" label="スタッフを選択" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} sx={{ minWidth: { xs: 0, sm: 200 }, width: { xs: '100%', sm: 'auto' }, bgcolor: 'background.paper' }}>
                                            <MenuItem value="all">全員を表示</MenuItem>
                                            {staffs.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                                        </TextField>
                                    )}
                                    {activeTab === 'byClient' && (
                                        <TextField select size="small" label="利用者を選択" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} sx={{ minWidth: { xs: 0, sm: 200 }, width: { xs: '100%', sm: 'auto' }, bgcolor: 'background.paper' }}>
                                            <MenuItem value="all">全員を表示</MenuItem>
                                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                                        </TextField>
                                    )}
                                </Box>
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
                            </Stack>
                        )}

                        {canUseOrgWideTabs && (
                            <Box sx={{ display: activeTab === 'patterns' ? 'block' : 'none' }}>
                                <Box sx={{ p: 2, mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'background.tint', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
                                    <Typography variant="body2" sx={{ fontWeight: '500' }}>登録したひな形をベースに、指定月のカレンダーへシフトを一括展開・同期します。</Typography>
                                    <Stack direction="row" spacing={1.5} alignItems="center">
                                        <MonthField size="small" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} />
                                        <Button variant="contained" color="secondary" startIcon={<PlayArrowIcon />} onClick={handleCalculatePreview} disabled={!canCreateShift || currentOrg.effectivePermissions.shifts.create !== 'all' || generating || patterns.length === 0} sx={{ boxShadow: 'none' }}>
                                            一括自動展開する
                                        </Button>
                                        <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={() => { setClearMode('unmodified'); setClearDialogOpen(true); }} disabled={!canDeleteShift || currentOrg.effectivePermissions.shifts.delete !== 'all' || generating || patterns.length === 0}>
                                            一括消去する
                                        </Button>
                                    </Stack>
                                </Box>

                                <Typography variant="subtitle1" fontWeight="bold" mb={2}>登録済みのひな形パターン一覧</Typography>
                                <TableContainer sx={{ borderRadius: 1, mb: 4 }}>
                                    <Table>
                                        <TableHead sx={{ bgcolor: 'background.subtle' }}>
                                            <TableRow>
                                                <TableCell sx={{ fontWeight: 'bold' }}>対象の利用者</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold' }}>デフォルト担当者</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold' }}>予定時間帯</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold' }}>繰り返しサイクル</TableCell>
                                                <TableCell align="center" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {patterns.length === 0 ? (
                                                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>ひな形が登録されていません</TableCell></TableRow>
                                            ) : (
                                                patterns.map((p) => (
                                                    <TableRow key={p.id} hover>
                                                        <TableCell sx={{ fontWeight: 'bold' }}>{p.clients?.name}</TableCell>
                                                        <TableCell>{p.shift_pattern_staffs.map(s => s.staffs?.name).join(', ') || '未割り当て'}</TableCell>
                                                        <TableCell>{p.start_time.slice(0, 5)} 〜 {p.end_time.slice(0, 5)}</TableCell>
                                                        <TableCell><Chip label={formatRule(p.rrule)} size="small" color="primary" variant="outlined" /></TableCell>
                                                        <TableCell align="center">
                                                            {canEditShift && <Tooltip title="ひな形を編集"><IconButton size="small" color="primary" onClick={() => { setSelectedPattern(p); setPatternModalOpen(true); }} sx={{ mr: 1 }}><EditIcon fontSize="small" /></IconButton></Tooltip>}
                                                            {canDeleteShift && <Tooltip title="ひな形を削除"><IconButton size="small" color="error" onClick={() => handleDeletePattern(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
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
                                    selectable={activeTab === 'fullCalendar' && canCreateShift}
                                    editable={activeTab === 'fullCalendar' && canEditShift}
                                    onEventDrop={handleEventChange}
                                    onEventResize={handleEventChange}
                                    onDatesSet={handleCalendarDatesSet}
                                    onDateSelect={(info) => {
                                        if (activeTab !== 'fullCalendar' || !canCreateShift) return;
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

            {syncProgress && (
                <Box sx={{ position: 'fixed', bottom: 20, right: 20, bgcolor: 'background.paper', p: 2.5, borderRadius: 1, boxShadow: 3, zIndex: 9999, border: '1px solid', borderColor: 'divider', minWidth: 280 }}>
                    <Typography variant="body2" fontWeight="bold" gutterBottom>Googleカレンダー同期中...</Typography>
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {syncProgress.currentName}
                    </Typography>
                    {syncProgress.total > 1 ? (
                        <>
                            <LinearProgress variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} sx={{ height: 6, borderRadius: 1 }} />
                            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right', fontWeight: 'bold' }}>
                                {syncProgress.current} / {syncProgress.total} 件完了
                            </Typography>
                        </>
                    ) : (
                        <LinearProgress sx={{ height: 6, borderRadius: 1 }} />
                    )}
                </Box>
            )}

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
                canSave={selectedShift?.id ? canEditShift : canCreateShift}
            />

            <ShiftPatternModal
                key={selectedPattern?.id ?? 'new_pattern'}
                open={patternModalOpen}
                onClose={() => setPatternModalOpen(false)}
                onSave={handleSavePattern}
                clients={clients}
                staffs={staffs}
                organizationId={currentOrg.id}
                initialData={selectedPattern}
            />

            <AppDialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)} maxWidth="xs" title={`${targetMonth}月の展開シフトを消去`} dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setClearDialogOpen(false)}>キャンセル</AppButton><AppButton onClick={executeClearMonthShifts} intent="danger">消去を実行</AppButton></>}>
                <Typography sx={{ mb: 2 }}>消去方法を選択してください。</Typography>
                <RadioGroup value={clearMode} onChange={(e) => setClearMode(e.target.value as 'unmodified' | 'all')}>
                    <FormControlLabel
                        value="unmodified"
                        control={<Radio />}
                        label={
                            <Box sx={{ py: 1 }}>
                                <Typography variant="body2" fontWeight="bold">未変更のシフトだけ消す（推奨）</Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    手動で時間調整や担当ヘルパーを変更した箇所のシフトは安全に残し、自動展開したまま手を付けていない予定だけを消去します。
                                </Typography>
                            </Box>
                        }
                    />
                    <FormControlLabel
                        value="all"
                        control={<Radio />}
                        label={
                            <Box sx={{ py: 1 }}>
                                <Typography variant="body2" fontWeight="bold" color="error">全部一括消去する</Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    個別調整・メモ・キャンセル済みの予定も含めて、ひな形から展開された予定をすべてクリアします。
                                </Typography>
                            </Box>
                        }
                    />
                </RadioGroup>
            </AppDialog>

            <AppDialog open={previewDialogOpen} onClose={() => setPreviewDialogOpen(false)} maxWidth="sm" title={`${targetMonth}月 シフト展開の確認`} actions={<><AppButton variant="text" intent="secondary" onClick={() => setPreviewDialogOpen(false)}>閉じる</AppButton><AppButton onClick={executeGenerate} intent="secondary" autoFocus>確定してカレンダーに展開</AppButton></>}>
                {previewDetails && (
                    <Stack spacing={2}>
                        <Typography variant="body2" paragraph>
                            以下の内容でカレンダーにシフト実体を作成します。既存の未編集シフトは自動で上書き更新され、現場で編集済みの調整シフトは安全にスキップ（自動保護）されます。
                        </Typography>
                        <Box p={2} bgcolor="background.tint" borderRadius={2} border="1px solid" borderColor="divider" mb={1.5}>
                            <Typography variant="subtitle2" fontWeight="bold" color="primary">展開予定の総シフト数： {previewDetails.total} 件</Typography>
                        </Box>
                        <Typography variant="subtitle2" fontWeight="bold">ひな形ごとの生成予定内訳:</Typography>
                        <Stack spacing={1} sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid', borderColor: 'divider', p: 1, borderRadius: 1, bgcolor: 'background.subtle' }}>
                            {previewDetails.details.map((d, index) => (
                                <Box key={index} display="flex" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" fontWeight="bold">{d.title}</Typography>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        {d.isOvernight && <Chip label="日またぎ夜勤" size="small" color="secondary" variant="outlined" sx={{ height: 16, fontSize: '0.65rem' }} />}
                                        <Typography variant="caption" color="text.secondary">{d.count} 件</Typography>
                                    </Stack>
                                </Box>
                            ))}
                        </Stack>
                    </Stack>
                )}
            </AppDialog>
        </Box>
    );
}
