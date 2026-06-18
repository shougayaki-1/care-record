'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Tabs, Tab, Button, Chip, IconButton, Tooltip, Stack, TextField,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, FormControlLabel, Radio, RadioGroup, LinearProgress,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, MenuItem, Alert
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import BuildIcon from '@mui/icons-material/Build'; 
import SyncIcon from '@mui/icons-material/Sync'; // ★追加: 同期アイコン
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventDropArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import {
    getShifts, createShift, updateShift, toggleCancelShift, updateShiftTimeOnly, deleteShiftCompletely,
    ShiftPayload, getShiftPatterns, createShiftPattern, deleteShiftPattern, updateShiftPattern,
    generateShiftsForMonth, previewShiftsForMonth, ShiftPatternPayload,
    getSyncStatus, syncUnsyncedBatch, forceSyncBatch, deleteShiftsBatch // 同期はチャンク方式のサーバーバッチに統一
} from '@/app/actions/shift';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { ShiftFormModal, ClientData, StaffData, ShiftData } from '@/components/shifts/ShiftFormModal';
import { ShiftPatternModal } from '@/components/shifts/ShiftPatternModal';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';

import { pdf } from '@react-pdf/renderer';
import { ShiftScheduleDocument, PdfShiftData } from '@/components/pdf/ShiftScheduleDocument';
import { ShiftCalendarDocument, PdfCalendarEvent, PdfCalendarDay } from '@/components/pdf/ShiftCalendarDocument';
import { ShiftMatrixDocument, MatrixStaffData } from '@/components/pdf/ShiftMatrixDocument';

type FetchedPatternData = {
    id: string;
    client_id: string;
    title: string;
    start_time: string;
    end_time: string;
    rrule: string;
    clients: { name: string } | null;
    shift_pattern_staffs: { staff_id: string; staffs: { name: string } | null; }[];
};

export default function ShiftManagePage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const calendarRef = useRef<FullCalendar>(null);

    const [initialLoading, setInitialLoading] = useState(true);
    const [isFetching, setIsFetching] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);

    const [rawShifts, setRawShifts] = useState<FetchedShiftData[]>([]);
    const [patterns, setPatterns] = useState<FetchedPatternData[]>([]);
    const [events, setEvents] = useState<EventInput[]>([]);

    const [clients, setClients] = useState<ClientData[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);

    const [currentUserId, setCurrentUserId] = useState<string>('');
    const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);

    const [tabIndex, setTabIndex] = useState(1);

    const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
    const [selectedClientId, setSelectedClientId] = useState<string>('all');

    const [targetMonth, setTargetMonth] = useState<string>(() => {
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

    // Googleカレンダーの同期進捗を監視するstate
    const [syncProgress, setSyncProgress] = useState<{ total: number; current: number; currentName: string } | null>(null);
    
    // 未同期件数を検知・管理するためのstate
    const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
    const [repairingFromBanner, setRepairingFromBanner] = useState(false);

    // ★追加: 強制全件再同期中ステート
    const [resyncingCal, setResyncingCal] = useState(false);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setCurrentUserId(user.id);
        };
        fetchUser();
    }, []);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: c } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
            if (c) setClients(c as ClientData[]);

            const { data: s } = await supabase.from('staffs').select('id, name, user_id').eq('organization_id', currentOrg.id).is('archived_at', null).order('sort_order', { ascending: true, nullsFirst: false }).order('name', { ascending: true });
            if (s) {
                const parsed = s.map(item => ({ id: item.id, name: item.name, type: item.user_id ? 'member' as const : 'ghost' as const }));
                setStaffs(parsed);

                if (currentUserId) {
                    const me = parsed.find(item => s.find(sd => sd.id === item.id)?.user_id === currentUserId);
                    if (me) setCurrentStaffId(me.id);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }, [currentOrg, currentUserId]);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!currentOrg) return;
        if (!isBackground) setInitialLoading(true);
        setIsFetching(true);

        const calendarApi = calendarRef.current?.getApi();
        const currentCalendarDate = calendarApi?.getDate();

        try {
            const fetchedPatterns = await getShiftPatterns(currentOrg.id);
            setPatterns((fetchedPatterns as unknown as FetchedPatternData[]) || []);

            const start = new Date(); start.setMonth(start.getMonth() - 2);
            const end = new Date(); end.setMonth(end.getMonth() + 6);
            const fetchedShifts = await getShifts(currentOrg.id, start.toISOString(), end.toISOString());
            const typedShifts = (fetchedShifts as unknown as FetchedShiftData[]) || [];

            typedShifts.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

            setRawShifts(typedShifts);
            setEvents(convertToCalendarEvents(typedShifts, false));

            // 未同期シフト数のチェック
            const { count: unsyncedCountResult } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', currentOrg.id)
                .is('google_event_id', null);
            setUnsyncedCount(unsyncedCountResult || 0);

            if (calendarApi && currentCalendarDate) {
                setTimeout(() => {
                    calendarApi.gotoDate(currentCalendarDate);
                }, 10);
            }
        } catch (error) {
            console.error(error);
            showToast('データの取得に失敗しました', 'error');
        } finally {
            setInitialLoading(false);
            setIsFetching(false);
        }
    }, [currentOrg, showToast]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchMasterData();
            fetchData();
        }
    }, [wsLoading, currentOrg, fetchMasterData, fetchData]);

    useEffect(() => {
        if (!currentUserId || rawShifts.length === 0) {
            setEvents([]);
            return;
        }

        const filtered = rawShifts.filter(shift => {
            if (tabIndex === 2) {
                if (!currentStaffId) return false;
                return shift.shift_staffs.some(s => s.staff_id === currentStaffId);
            }
            if (tabIndex === 3) {
                if (selectedStaffId === 'all') return true;
                return shift.shift_staffs.some(s => s.staff_id === selectedStaffId);
            }
            if (tabIndex === 4) {
                if (selectedClientId === 'all') return true;
                return shift.client_id === selectedClientId;
            }
            return true;
        });

        const isEditable = tabIndex === 1 && ['owner', 'manager'].includes(currentOrg?.role || '');
        setEvents(convertToCalendarEvents(filtered, !isEditable));
    }, [rawShifts, tabIndex, selectedStaffId, selectedClientId, currentStaffId, currentUserId, currentOrg]);

    const handleDownloadPdf = async () => {
        if (!calendarRef.current || !currentOrg) return;
        setPdfGenerating(true);
        try {
            const api = calendarRef.current.getApi();
            const renderedEvents = api.getEvents();
            const viewType = api.view.type;
            const monthStr = api.view.title;

            let entityName = '全体シフト';
            if (tabIndex === 2) entityName = '私のシフト';
            else if (tabIndex === 3) entityName = selectedStaffId !== 'all' ? `${staffs.find(s => s.id === selectedStaffId)?.name}様` : '全スタッフ';
            else if (tabIndex === 4) entityName = selectedClientId !== 'all' ? `${clients.find(c => c.id === selectedClientId)?.name}様` : '全利用者';

            const docTitle = `${entityName} シフト表`;
            const fileName = `${entityName}_シフト表_${monthStr.replace(/\s+/g, '')}.pdf`;

            // ヘッダーと表の間に表示するスタッフ名＋役職の一覧を取得（一覧表・カレンダー共通）
            const { data: staffRows } = await supabase
                .from('staffs')
                .select('name, positions')
                .eq('organization_id', currentOrg.id)
                .is('archived_at', null)
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });
            const staffMembers = (staffRows || []).map(s => ({ name: s.name as string, positions: (s.positions as string[] | null) ?? [] }));

            let blob: Blob;

            if (viewType.includes('list')) {
                const pdfShifts: PdfShiftData[] = [];
                renderedEvents.forEach(ev => {
                    const start = ev.start!;
                    const end = ev.end!;
                    const days = ['日', '月', '火', '水', '木', '金', '土'];

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
                        // 印刷用PDF出力時: 繋がっている夜勤シフトを00:00で分割処理
                        // Part 1: 開始時間 〜 24:00
                        pdfShifts.push({
                            dateStr: `${start.getMonth() + 1}/${start.getDate()} (${days[start.getDay()]})`,
                            startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                            endTime: `24:00`,
                            clientName: ev.extendedProps.clientName,
                            staffNames: ev.extendedProps.staffNames,
                            isCancelled: ev.extendedProps.isCancelled,
                            timestamp: start.getTime()
                        });
                        // Part 2: 翌日00:00 〜 終了時間
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
                blob = await pdf(<ShiftScheduleDocument title={docTitle} monthStr={monthStr} shifts={pdfShifts} orgName={currentOrg.name} staffMembers={staffMembers} />).toBlob();
            } else {
                const activeStart = api.view.activeStart;
                const activeEnd = api.view.activeEnd;
                const dayMap = new Map<string, PdfCalendarEvent[]>();

                renderedEvents.forEach(ev => {
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

                blob = await pdf(<ShiftCalendarDocument title={docTitle} monthStr={monthStr} weeks={weeks} orgName={currentOrg.name} staffMembers={staffMembers} />).toBlob();
            }

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();
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
            const api = calendarRef.current.getApi();
            const currentMonthStart = api.view.currentStart;
            const year = currentMonthStart.getFullYear();
            const month = currentMonthStart.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const monthStr = `${year}年 ${month + 1}月`;

            const docTitle = `全体シフト表 (スタッフ横断)`;
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

            // スタッフ名簿で設定した並び順（sort_order）をそのまま採用する（staffs は既にその順序で取得済み）
            const staffDataArray = Array.from(matrixMap.values());

            // ヘッダーと表の間に表示するスタッフ名＋役職の一覧を取得
            const { data: staffRows } = await supabase
                .from('staffs')
                .select('name, positions')
                .eq('organization_id', currentOrg.id)
                .is('archived_at', null)
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });
            const staffMembers = (staffRows || []).map(s => ({ name: s.name as string, positions: (s.positions as string[] | null) ?? [] }));

            const blob = await pdf(
                <ShiftMatrixDocument
                    title={docTitle}
                    monthStr={monthStr}
                    daysInMonth={daysInMonth}
                    staffData={staffDataArray}
                    orgName={currentOrg.name}
                    staffMembers={staffMembers}
                />
            ).toBlob();

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.click();

        } catch (error) {
            console.error(error);
            showToast('全体マトリックスPDFの生成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    };

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
            await deleteShiftCompletely(shiftId);
            showToast('シフトを完全に削除しました');
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

    const handleOpenClearConfirm = () => {
        setClearMode('unmodified');
        setClearDialogOpen(true);
    };

    const executeClearMonthShifts = async () => {
        if (!currentOrg) return;
        setClearDialogOpen(false);
        setGenerating(true);

        try {
            // 1. クリア対象となる予定をフロントエンド側で特定・取得
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

            if (clearMode === 'unmodified') {
                query = query.eq('is_modified', false);
            }

            const { data: targetShifts, error: queryError } = await query;
            if (queryError) throw queryError;

            if (!targetShifts || targetShifts.length === 0) {
                showToast(`${targetMonth}月に消去対象の予定はありませんでした。`, 'info');
                setGenerating(false);
                return;
            }

            // 2. チャンク単位でサーバーに削除を依頼（Googleから削除できた分のみDB削除＝孤児イベントを残さない）
            setGenerating(false);
            const total = targetShifts.length;
            setSyncProgress({ total, current: 0, currentName: '一括消去を開始中...' });

            const shiftIds = targetShifts.map(s => s.id);
            const CHUNK = 20;
            let deleted = 0, failed = 0;
            let errorKind: string | undefined;

            for (let i = 0; i < shiftIds.length; i += CHUNK) {
                const chunk = shiftIds.slice(i, i + CHUNK);
                const res = await deleteShiftsBatch(currentOrg.id, chunk);
                deleted += res.deleted;
                failed += res.failed;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, deleted + failed), currentName: `${Math.min(total, deleted + failed)} / ${total} 件 処理済み` });
                if (errorKind === 'auth') break; // 認証切れは継続不可
            }

            setSyncProgress(null);

            if (errorKind === 'auth') {
                showToast('Googleカレンダーの認証が切れています。設定画面から再接続後にもう一度お試しください。', 'error');
            } else if (failed > 0) {
                showToast(`${deleted} 件を消去しました。${failed} 件はGoogleカレンダーから削除できず残っています。通信状況を確認し再度お試しください。`, 'warning');
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

    // 同期結果に応じたメッセージを表示する共通処理
    const reportSyncResult = (done: number, failed: number, errorKind?: string) => {
        if (errorKind === 'auth') {
            showToast('Googleカレンダーの認証が切れています。設定画面から連携を再接続してください。', 'error');
        } else if (failed > 0) {
            showToast(`同期が一部失敗しました（成功 ${done} 件 / 失敗 ${failed} 件）。通信状況を確認し、しばらくしてから再同期してください。`, 'warning');
        } else {
            showToast(`Googleカレンダーへの同期が完了しました（${done} 件）。`, 'success');
        }
    };

    // 未同期件数をサーバーから取得して表示を更新
    const refreshUnsyncedCount = async () => {
        if (!currentOrg) return;
        const status = await getSyncStatus(currentOrg.id);
        setUnsyncedCount(status.unsynced);
    };

    // 未同期シフトをチャンク単位でサーバー一括同期するループ（タイムアウト回避・再開可能）
    const runUnsyncedSyncLoop = async (): Promise<boolean> => {
        if (!currentOrg) return false;
        const status = await getSyncStatus(currentOrg.id);
        if (!status.connected) {
            showToast('Googleカレンダーが連携されていません。設定画面から接続してください。', 'warning');
            return false;
        }
        const total = status.unsynced;
        if (total === 0) { await refreshUnsyncedCount(); return true; }

        setSyncProgress({ total, current: 0, currentName: 'Googleカレンダーへ同期中...' });
        let done = 0, failed = 0;
        let errorKind: string | undefined;
        try {
            for (;;) {
                const res = await syncUnsyncedBatch(currentOrg.id, 20);
                done += res.succeeded;
                failed += res.failed;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, done), currentName: `${Math.min(total, done)} / ${total} 件 同期済み` });
                // 認証切れ・残件ゼロ・進捗が出ない（全件失敗）場合はループを抜ける
                if (errorKind === 'auth' || res.remaining <= 0 || res.succeeded === 0) break;
            }
        } finally {
            setSyncProgress(null);
            await refreshUnsyncedCount();
        }
        reportSyncResult(done, failed, errorKind);
        return failed === 0 && errorKind !== 'auth';
    };

    // 全件強制再同期をチャンク単位でサーバー処理するループ
    const runForceSyncLoop = async (): Promise<boolean> => {
        if (!currentOrg) return false;
        const status = await getSyncStatus(currentOrg.id);
        if (!status.connected) {
            showToast('Googleカレンダーが連携されていません。設定画面から接続してください。', 'warning');
            return false;
        }
        const total = status.total;
        if (total === 0) return true;

        setSyncProgress({ total, current: 0, currentName: '全件再同期の準備中...' });
        let cursor: string | null = null;
        let done = 0, failed = 0;
        let errorKind: string | undefined;
        try {
            for (;;) {
                const res = await forceSyncBatch(currentOrg.id, cursor, 20);
                done += res.processed;
                failed += res.failed;
                cursor = res.nextCursor;
                if (res.errorKind) errorKind = res.errorKind;
                setSyncProgress({ total, current: Math.min(total, done), currentName: `${Math.min(total, done)} / ${total} 件 再同期済み` });
                if (errorKind === 'auth' || res.remaining <= 0 || res.processed === 0) break;
            }
        } finally {
            setSyncProgress(null);
            await refreshUnsyncedCount();
        }
        reportSyncResult(done, failed, errorKind);
        return failed === 0 && errorKind !== 'auth';
    };

    const executeGenerate = async () => {
        if (!currentOrg) return;
        setPreviewDialogOpen(false);
        setGenerating(true);

        try {
            // 1. Googleカレンダー同期を一旦スキップした状態で、シフト実体をDBに一括超高速生成 (DB挿入のみ)
            const res = await generateShiftsForMonth(currentOrg.id, targetMonth);

            // 2. DB生成が完了した時点で、即座にローディングを解除してカレンダー画面を表示！
            setGenerating(false);
            setTabIndex(1);
            showToast(`${targetMonth}月のシフト ${res.count} 件を生成しました。続けてGoogleカレンダーへ同期します。`, 'success');

            // すぐにアプリ内カレンダーを最新情報に更新して描画
            fetchData(true);

            // 3. 未同期シフトをサーバー側のチャンクバッチで同期（タブを閉じても残件は後から再同期可能）
            await runUnsyncedSyncLoop();
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('シフトの自動展開に失敗しました。', 'error');
            setGenerating(false);
        }
    };

    // 警告バナー / 同期ステータスから未同期シフトの再同期を実行する
    const handleRepairFromBanner = async () => {
        if (!currentOrg) return;
        setRepairingFromBanner(true);
        try {
            await runUnsyncedSyncLoop();
            fetchData(true);
        } finally {
            setRepairingFromBanner(false);
        }
    };

    // 全件強制再同期（タイムアウト回避のためサーバー側チャンク処理をループ）
    const handleForceResyncCalendar = async () => {
        if (!currentOrg || rawShifts.length === 0) return;
        if (!(await confirm({ message: `カレンダーに登録されているすべての予定をGoogleカレンダーへ強制的に再同期します。よろしいですか？\n※件数が多い場合は完了まで時間がかかります。` }))) return;

        setResyncingCal(true);
        try {
            await runForceSyncLoop();
            fetchData(true);
        } finally {
            setResyncingCal(false);
        }
    };

    const formatRule = (rrule: string) => {
        let desc = '';
        if (rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
        else if (rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';

        const intervalMatch = rrule.match(/INTERVAL=([0-9]+)/);
        if (intervalMatch && intervalMatch[1] !== '1') desc = `${intervalMatch[1]}週間に1回 `;

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

    if (wsLoading || !currentOrg) return null;

    const isAdmin = ['owner', 'manager'].includes(currentOrg.role);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="h6" fontWeight="bold">全体シフト管理</Typography>
                    {isAdmin && tabIndex === 1 && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setShiftModalOpen(true); }} sx={{ boxShadow: 'none' }}>単発シフトを追加</Button>
                    )}
                    {isAdmin && tabIndex === 0 && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedPattern(null); setPatternModalOpen(true); }} sx={{ boxShadow: 'none' }}>ひな形を追加</Button>
                    )}
                </Box>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    {isAdmin && <Tab label="基本パターン(ひな形)" />}
                    {isAdmin && <Tab label="全体カレンダー" />}
                    <Tab label="自分のシフト" />
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                </Tabs>
            </Box>

            <Box sx={{ position: 'relative', flexGrow: 1, p: 3, bgcolor: '#f5f5f5', overflowY: 'auto' }}>
                {isFetching && !initialLoading && (
                    <Box sx={{ position: 'absolute', top: 16, right: 30, zIndex: 10 }}>
                        <CircularProgress size={24} />
                    </Box>
                )}

                {initialLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                ) : (
                    <>
                        {/* ブラウザ閉鎖等による同期未完了シフトを検知した際のリカバリー用修復警告バナー */}
                        {unsyncedCount > 0 && isAdmin && (
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
                                sx={{ mb: 2, borderRadius: 3, boxShadow: 'none', border: '1px solid #ffe0b2' }}
                            >
                                Googleカレンダーと同期されていない予定が <strong>{unsyncedCount} 件</strong> あります。前回の自動展開が途中で中断された場合はこちらから同期を再開できます。
                            </Alert>
                        )}

                        {tabIndex >= 1 && (
                            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={2} spacing={2}>
                                <Box flexGrow={1} width="100%">
                                    {tabIndex === 3 && (
                                        <TextField select size="small" label="スタッフを選択" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} sx={{ minWidth: 200, bgcolor: 'white' }}>
                                            <MenuItem value="all">全員を表示</MenuItem>
                                            {staffs.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                                        </TextField>
                                    )}
                                    {tabIndex === 4 && (
                                        <TextField select size="small" label="利用者を選択" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} sx={{ minWidth: 200, bgcolor: 'white' }}>
                                            <MenuItem value="all">全員を表示</MenuItem>
                                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                                        </TextField>
                                    )}
                                </Box>
                                <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
                                    {/* ★追加: 管理者用 Googleカレンダー全件強制再同期ボタン */}
                                    {isAdmin && (
                                        <Button 
                                            variant="outlined" 
                                            color="primary" 
                                            startIcon={resyncingCal ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />} 
                                            onClick={handleForceResyncCalendar} 
                                            disabled={resyncingCal || pdfGenerating}
                                            sx={{ bgcolor: 'white' }}
                                        >
                                            {resyncingCal ? '再同期中...' : 'Googleカレンダー全件再同期'}
                                        </Button>
                                    )}
                                    {tabIndex === 3 && selectedStaffId === 'all' && (
                                        <Button variant="outlined" color="primary" startIcon={<GridOnIcon />} onClick={handleDownloadMatrixPdf} disabled={pdfGenerating || resyncingCal} sx={{ bgcolor: 'white' }}>
                                            {pdfGenerating ? '作成中...' : '全体マトリックスPDF'}
                                        </Button>
                                    )}
                                    <Button variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleDownloadPdf} disabled={pdfGenerating || resyncingCal} sx={{ bgcolor: 'white' }}>
                                        {pdfGenerating ? '作成中...' : '表示中の形式でPDF出力'}
                                    </Button>
                                </Stack>
                            </Stack>
                        )}

                        {isAdmin && (
                            <Box sx={{ display: tabIndex === 0 ? 'block' : 'none' }}>
                                <Paper variant="outlined" sx={{ p: 2, mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 2, bgcolor: '#F0F5FF', borderColor: '#D0E0FF' }}>
                                    <Typography variant="body2" sx={{ fontWeight: '500' }}>登録したひな形をベースに、指定月のカレンダーへシフトを一括展開・同期します。</Typography>
                                    <Stack direction="row" spacing={1.5} alignItems="center">
                                        <TextField type="month" size="small" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} sx={{ bgcolor: 'white' }} />
                                        <Button variant="contained" color="secondary" startIcon={<PlayArrowIcon />} onClick={handleCalculatePreview} disabled={generating || patterns.length === 0} sx={{ boxShadow: 'none' }}>
                                            一括自動展開する
                                        </Button>
                                        <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={handleOpenClearConfirm} disabled={generating || patterns.length === 0}>
                                            一括消去する
                                        </Button>
                                    </Stack>
                                </Paper>

                                <Typography variant="subtitle1" fontWeight="bold" mb={2}>登録済みのひな形パターン一覧</Typography>
                                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, mb: 4 }}>
                                    <Table>
                                        <TableHead sx={{ bgcolor: '#fafafa' }}>
                                            <TableRow>
                                                <TableCell sx={{ fontWeight: 'bold' }}>対象の利用者</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold' }}>デフォルト担当者</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold' }}>予定時間帯</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold' }}>繰り返しサイクル</TableCell>
                                                <TableCell align="center" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {patterns.length === 0 ? <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: '#666' }}>ひな形が登録されていません</TableCell></TableRow> : (
                                                patterns.map((p) => (
                                                    <TableRow key={p.id} hover>
                                                        <TableCell sx={{ fontWeight: 'bold' }}>{p.clients?.name}</TableCell>
                                                        <TableCell>{p.shift_pattern_staffs.map(s => s.staffs?.name).join(', ') || '未割り当て'}</TableCell>
                                                        <TableCell>{p.start_time.slice(0, 5)} 〜 {p.end_time.slice(0, 5)}</TableCell>
                                                        <TableCell><Chip label={formatRule(p.rrule)} size="small" color="primary" variant="outlined" /></TableCell>
                                                        <TableCell align="center">
                                                            <Tooltip title="ひな形を編集"><IconButton size="small" color="primary" onClick={() => { setSelectedPattern(p); setPatternModalOpen(true); }} sx={{ mr: 1 }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                                            <Tooltip title="ひな形を削除"><IconButton size="small" color="error" onClick={() => handleDeletePattern(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </Box>
                        )}

                        {tabIndex >= 1 && (
                            <Box sx={{ height: '100%' }}>
                                <ShiftCalendarViewer
                                    ref={calendarRef}
                                    events={events}
                                    initialView={tabIndex === 2 ? "listMonth" : "dayGridMonth"}
                                    headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth' }}
                                    buttonText={{ listMonth: 'リスト', dayGridMonth: '月間', timeGridWeek: '週間' }}
                                    selectable={tabIndex === 1 && isAdmin}
                                    editable={tabIndex === 1 && isAdmin}
                                    onEventDrop={handleEventChange}
                                    onEventResize={handleEventChange}
                                    onDateSelect={(info) => {
                                        if (tabIndex !== 1 || !isAdmin) return;
                                        setSelectedShift({
                                            id: '', client_id: '', title: '', start_at: info.startStr, end_at: info.endStr,
                                            status: 'published', cancel_reason: '', shift_staffs: []
                                        });
                                        setShiftModalOpen(true);
                                    }}
                                    onEventClick={(info) => {
                                        const { clientId, shiftId, isCancelled, shiftData } = info.event.extendedProps;
                                        if (tabIndex === 1 && isAdmin) {
                                            setSelectedShift(shiftData);
                                            setShiftModalOpen(true);
                                        } else {
                                            if (isCancelled) {
                                                showToast('このシフトは現在キャンセル（お休み）されています。', 'info');
                                                return;
                                            }
                                            window.location.href = `/app/record/${clientId}?shiftId=${shiftId}`;
                                        }
                                    }}
                                />
                            </Box>
                        )}
                    </>
                )}
            </Box>

            {/* Googleカレンダー同期中のプログレス表示UI */}
            {syncProgress && (
                <Box sx={{ position: 'fixed', bottom: 20, right: 20, bgcolor: 'white', p: 2.5, borderRadius: 3, boxShadow: 3, zIndex: 9999, border: '1px solid #E3E5E8', minWidth: 280 }}>
                    <Typography variant="body2" fontWeight="bold" gutterBottom>Googleカレンダー同期中...</Typography>
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {syncProgress.currentName}
                    </Typography>
                    {/* 件数が複数の場合のみ、パーセンテージ付きの進捗バーにする */}
                    {syncProgress.total > 1 ? (
                        <>
                            <LinearProgress variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
                            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right', fontWeight: 'bold' }}>
                                {syncProgress.current} / {syncProgress.total} 件完了
                            </Typography>
                        </>
                    ) : (
                        <LinearProgress sx={{ height: 6, borderRadius: 3 }} />
                    )}
                </Box>
            )}

            <ShiftFormModal
                open={shiftModalOpen}
                onClose={() => setShiftModalOpen(false)}
                onSave={handleSaveShift}
                onToggleCancel={handleToggleCancel}
                onDelete={handleDeleteShift}
                clients={clients}
                staffs={staffs}
                organizationId={currentOrg.id}
                initialData={selectedShift}
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

            <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontWeight: 'bold' }}>{targetMonth}月の展開シフトを消去</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        消去方法を選択してください。
                    </DialogContentText>
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
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setClearDialogOpen(false)} color="inherit">キャンセル</Button>
                    <Button onClick={executeClearMonthShifts} variant="contained" color="error">消去を実行</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={previewDialogOpen} onClose={() => setPreviewDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 'bold' }}>{targetMonth}月 シフト展開の確認</DialogTitle>
                <DialogContent dividers>
                    {previewDetails && (
                        <Stack spacing={2}>
                            <Typography variant="body2" paragraph>
                                以下の内容でカレンダーにシフト実体を作成します。既存の未編集シフトは自動で上書き更新され、現場で編集済みの調整シフトは安全にスキップ（自動保護）されます。
                            </Typography>
                            <Box p={2} bgcolor="#F0F5FF" borderRadius={2} border="1px solid #D0E0FF" mb={1.5}>
                                <Typography variant="subtitle2" fontWeight="bold" color="primary">展開予定の総シフト数： {previewDetails.total} 件</Typography>
                            </Box>
                            <Typography variant="subtitle2" fontWeight="bold">ひな形ごとの生成予定内訳:</Typography>
                            <Stack spacing={1} sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eee', p: 1, borderRadius: 1, bgcolor: '#fbfbfb' }}>
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
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setPreviewDialogOpen(false)} color="inherit">閉じる</Button>
                    <Button onClick={executeGenerate} variant="contained" color="secondary" autoFocus>
                        確定してカレンダーに展開
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}