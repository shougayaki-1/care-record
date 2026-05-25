'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Box, Typography, Paper, CircularProgress, Tabs, Tab, Button, Chip, IconButton, Tooltip, Stack, TextField,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, FormControlLabel, Radio, RadioGroup, LinearProgress,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox, MenuItem
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventDropArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import {
    getShifts, createShift, updateShift, toggleCancelShift, updateShiftTimeOnly, deleteShiftCompletely,
    ShiftPayload, getShiftPatterns, createShiftPattern, deleteShiftPattern, updateShiftPattern,
    clearGeneratedShiftsForMonth, generateShiftsForMonth, previewShiftsForMonth, ShiftPatternPayload
} from '@/app/actions/shift';
import { useToast } from '@/components/ui/ToastProvider';
import { ShiftFormModal, ClientData, StaffData, ShiftData } from '@/components/shifts/ShiftFormModal';
import { ShiftPatternModal } from '@/components/shifts/ShiftPatternModal';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';

// 高度なPDF出力用のコンポーネントとライブラリ
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

    // ユーザー情報
    const [currentUserId, setCurrentUserId] = useState<string>('');
    const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);

    // 5つの詳細タブ制御
    // 0: ひな形パターン, 1: 全体カレンダー, 2: 自分のシフト, 3: スタッフ別, 4: 利用者別
    const [tabIndex, setTabIndex] = useState(1);

    // フィルター用State
    const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
    const [selectedClientId, setSelectedClientId] = useState<string>('all');

    const [targetMonth, setTargetMonth] = useState<string>(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    // モーダル・ダイアログ制御
    const [shiftModalOpen, setShiftModalOpen] = useState(false);
    const [patternModalOpen, setPatternModalOpen] = useState(false);
    const [clearDialogOpen, setClearDialogOpen] = useState(false);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

    const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);
    const [selectedPattern, setSelectedPattern] = useState<FetchedPatternData | null>(null);

    // 消去設定
    const [clearMode, setClearMode] = useState<'unmodified' | 'all'>('unmodified');

    // 自動生成プレビュー用State
    const [previewDetails, setPreviewDetails] = useState<{ total: number; details: any[] } | null>(null);

    // 一括削除用のState
    const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);

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

            const { data: s } = await supabase.from('staffs').select('id, name, user_id').eq('organization_id', currentOrg.id);
            if (s) {
                const parsed = s.map(item => ({ id: item.id, name: item.name, type: item.user_id ? 'member' as const : 'ghost' as const }));
                setStaffs(parsed);

                // ログインユーザー自身に紐づく名簿IDを特定する
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
            setSelectedShiftIds([]);
        }
    }, [currentOrg, showToast]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchMasterData();
            fetchData();
        }
    }, [wsLoading, currentOrg, fetchMasterData, fetchData]);

    // タブ選択、または各種フィルター適用時に、表示用カレンダーイベントを動的にフィルタリング
    useEffect(() => {
        if (!currentUserId || rawShifts.length === 0) {
            setEvents([]);
            return;
        }

        const filtered = rawShifts.filter(shift => {
            // 2: 自分のシフト
            if (tabIndex === 2) {
                if (!currentStaffId) return false;
                return shift.shift_staffs.some(s => s.staff_id === currentStaffId);
            }
            // 3: スタッフ別
            if (tabIndex === 3) {
                if (selectedStaffId === 'all') return true;
                return shift.shift_staffs.some(s => s.staff_id === selectedStaffId);
            }
            // 4: 利用者別
            if (tabIndex === 4) {
                if (selectedClientId === 'all') return true;
                return shift.client_id === selectedClientId;
            }
            return true;
        });

        // 管理者タブ以外は、カレンダー上でのドラッグ＆ドロップなどの直接編集を不許可（読み取り専用にする）
        const isEditable = tabIndex === 1 && ['owner', 'manager'].includes(currentOrg?.role || '');
        setEvents(convertToCalendarEvents(filtered, !isEditable));
    }, [rawShifts, tabIndex, selectedStaffId, selectedClientId, currentStaffId, currentUserId, currentOrg]);

    // --- 高度なPDF出力・エクスポート機能 ---
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

            let blob: Blob;

            // リスト（List）ビュー表示中の場合：リスト形式PDFを出力
            if (viewType.includes('list')) {
                const pdfShifts: PdfShiftData[] = renderedEvents.map(ev => {
                    const start = ev.start!;
                    const end = ev.end!;
                    const days = ['日', '月', '火', '水', '木', '金', '土'];
                    return {
                        dateStr: `${start.getMonth() + 1}/${start.getDate()} (${days[start.getDay()]})`,
                        startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
                        endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                        clientName: ev.extendedProps.clientName,
                        staffNames: ev.extendedProps.staffNames,
                        isCancelled: ev.extendedProps.isCancelled,
                        timestamp: start.getTime()
                    };
                });
                pdfShifts.sort((a, b) => a.timestamp - b.timestamp);
                blob = await pdf(<ShiftScheduleDocument title={docTitle} monthStr={monthStr} shifts={pdfShifts} orgName={currentOrg.name} />).toBlob();
            }
            // 月間・週間カレンダー表示中の場合：カレンダー型レイアウトPDFを出力（日を跨ぐシフトに完全対応）
            else {
                const activeStart = api.view.activeStart;
                const activeEnd = api.view.activeEnd;
                const dayMap = new Map<string, PdfCalendarEvent[]>();

                renderedEvents.forEach(ev => {
                    const start = new Date(ev.start!);
                    const end = new Date(ev.end!);

                    // 開始日と終了日の日付の差をローカル日付基準で計算
                    const startZero = new Date(start.getFullYear(), start.getMonth(), start.getDate());
                    const endZero = new Date(end.getFullYear(), end.getMonth(), end.getDate());

                    const diffTime = endZero.getTime() - startZero.getTime();
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays === 0) {
                        // 同一日のシフト
                        const dateKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
                        const eventObj: PdfCalendarEvent = {
                            timeStr: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}-${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
                            clientName: ev.extendedProps.clientName,
                            staffNames: ev.extendedProps.staffNames,
                            isCancelled: ev.extendedProps.isCancelled,
                        };
                        if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
                        dayMap.get(dateKey)!.push(eventObj);
                    } else {
                        // 日またぎのシフト：跨いでいる日数分ループして各日のセルに予定を分割登録する
                        for (let d = 0; d <= diffDays; d++) {
                            const currentDay = new Date(startZero);
                            currentDay.setDate(startZero.getDate() + d);

                            const dateKey = `${currentDay.getFullYear()}-${String(currentDay.getMonth() + 1).padStart(2, '0')}-${String(currentDay.getDate()).padStart(2, '0')}`;

                            let timeDisplay = '';
                            if (d === 0) {
                                // 跨ぎの開始日（「20:00〜翌」から「20:00〜00:00」に変更）
                                timeDisplay = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}〜00:00`;
                            } else if (d === diffDays) {
                                // 終了時刻がちょうど 00:00 の場合は、翌日（終了日）のセルに不要な 00:00〜00:00 を表示しないようスキップする
                                if (end.getHours() === 0 && end.getMinutes() === 0) {
                                    continue;
                                }
                                // 跨ぎの終了日（「〜09:00」から「00:00〜09:00」に変更）
                                timeDisplay = `00:00〜${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                            } else {
                                // 2日以上跨ぐ場合の中間日
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
                blob = await pdf(<ShiftCalendarDocument title={docTitle} monthStr={monthStr} weeks={weeks} orgName={currentOrg.name} />).toBlob();
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

    // マトリックス全体シフト表（スタッフ横断グリッド表）の自動作成・PDF出力機能
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

            const staffDataArray = Array.from(matrixMap.values()).sort((a, b) => a.staffName.localeCompare(b.staffName));

            const blob = await pdf(
                <ShiftMatrixDocument
                    title={docTitle}
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

        } catch (error) {
            console.error(error);
            showToast('全体マトリックスPDFの生成に失敗しました', 'error');
        } finally {
            setPdfGenerating(false);
        }
    };

    // --- シフト単体操作 ---
    const handleSaveShift = async (payload: ShiftPayload, shiftId?: string) => {
        try {
            if (shiftId) await updateShift(shiftId, payload);
            else await createShift(payload);
            showToast('シフト情報を保存しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('保存に失敗しました', 'error');
        }
    };

    const handleToggleCancel = async (shiftId: string, isCancel: boolean, reason: string) => {
        try {
            await toggleCancelShift(shiftId, isCancel, reason);
            showToast(isCancel ? 'シフトをお休みに設定しました' : '通常予定に復元しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('変更に失敗しました', 'error');
        }
    };

    const handleDeleteShift = async (shiftId: string) => {
        try {
            await deleteShiftCompletely(shiftId);
            showToast('シフトを完全に削除しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('削除に失敗しました', 'error');
        }
    };

    const handleEventChange = async (info: EventDropArg | EventResizeDoneArg) => {
        const shiftId = info.event.extendedProps.shiftId;
        const start = info.event.start?.toISOString() || '';
        const end = info.event.end ? info.event.end.toISOString() : new Date(info.event.start!.getTime() + 3600000).toISOString();

        try {
            await updateShiftTimeOnly(shiftId, start, end);
            showToast('シフト時間を調整しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            info.revert();
            showToast('変更に失敗しました', 'error');
        }
    };

    // --- ひな形・自動生成操作 ---
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
            const unmodifiedOnly = clearMode === 'unmodified';
            const res = await clearGeneratedShiftsForMonth(currentOrg.id, targetMonth, unmodifiedOnly);
            showToast(`${targetMonth}月の対象シフトを ${res.count} 件消去しました。`, 'success');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('消去に失敗しました', 'error');
        } finally {
            setGenerating(false);
        }
    };

    const handleDeletePattern = async (id: string) => {
        if (!confirm('このひな形を削除しますか？\n（※すでに展開済みのカレンダー上のシフト実体は削除されません）')) return;
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
            showToast(`カレンダーに ${res.count} 件展開、${res.updated} 件更新しました。(微調整済み ${res.skipped} 件を自動保護)`, 'success');
            fetchData(true);
            setTabIndex(1);
        } catch (error) {
            console.error(error);
            showToast('自動展開に失敗しました', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // ひな形の繰り返し規則（rrule文字列）をわかりやすい日本語に変換する補助関数
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

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedShiftIds(rawShifts.slice(0, 100).map(s => s.id));
        } else {
            setSelectedShiftIds([]);
        }
    };

    const handleSelectOne = (id: string) => {
        setSelectedShiftIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
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
                        {/* --- 共通のヘッダー・フィルターコントロール (カレンダー表示系タブのみに動的表示) --- */}
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
                                    {tabIndex === 3 && selectedStaffId === 'all' && (
                                        <Button variant="outlined" color="primary" startIcon={<GridOnIcon />} onClick={handleDownloadMatrixPdf} disabled={pdfGenerating} sx={{ bgcolor: 'white' }}>
                                            {pdfGenerating ? '作成中...' : '全体マトリックスPDF'}
                                        </Button>
                                    )}
                                    <Button variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleDownloadPdf} disabled={pdfGenerating} sx={{ bgcolor: 'white' }}>
                                        {pdfGenerating ? '作成中...' : '表示中の形式でPDF出力'}
                                    </Button>
                                </Stack>
                            </Stack>
                        )}

                        {/* --- タブ0: ひな形（パターン）管理タブ --- */}
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

                        {/* --- カレンダー表示 (各カレンダータブがこれを利用してFullCalendarを描画) --- */}
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
                                        // 管理者かつ全体カレンダーの場合は「編集モーダル」を開く
                                        if (tabIndex === 1 && isAdmin) {
                                            setSelectedShift(shiftData);
                                            setShiftModalOpen(true);
                                        }
                                        // それ以外（ヘルパーが自分のシフト等を見る場合）は、クリックで「提供記録票の入力」へ遷移させる
                                        else {
                                            if (isCancelled) {
                                                showToast('このシフトは現在キャンセル（お休み）されています。', 'info');
                                                return;
                                            }
                                            // 記録入力画面へ遷移
                                            window.location.href = `/app/record/${clientId}?shiftId=${shiftId}`;
                                        }
                                    }}
                                />
                            </Box>
                        )}
                    </>
                )}
            </Box>

            {/* --- 各種ダイアログ・モーダル --- */}
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
                                            {d.isOvernight && <Chip label="泊まり日またぎ" size="small" color="secondary" variant="outlined" sx={{ height: 16, fontSize: '0.65rem' }} />}
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