'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Typography, Paper, CircularProgress, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Chip, IconButton, Tooltip, Stack, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FullCalendar from '@fullcalendar/react';
import { EventInput, EventDropArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';

import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { getShifts, createShift, updateShift, toggleCancelShift, updateShiftTimeOnly, ShiftPayload, getShiftPatterns, createShiftPattern, deleteShiftPattern, generateShiftsForMonth, ShiftPatternPayload } from '@/app/actions/shift';
import { useToast } from '@/components/ui/ToastProvider';
import { ShiftFormModal, ClientData, StaffData, ShiftData } from '@/components/shifts/ShiftFormModal';
import { ShiftPatternModal } from '@/components/shifts/ShiftPatternModal';
import { FetchedShiftData, convertToCalendarEvents } from '@/utils/shiftHelper';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';

type FetchedPatternData = { id: string; client_id: string; title: string; start_time: string; end_time: string; rrule: string; clients: { name: string } | null; shift_pattern_staffs: { staff_id: string; staffs: { name: string } | null; }[]; };

export default function ShiftManagePage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const calendarRef = useRef<FullCalendar>(null);

    const [initialLoading, setInitialLoading] = useState(true); // 初回ロード用
    const [isFetching, setIsFetching] = useState(false);        // バックグラウンド更新用
    const [generating, setGenerating] = useState(false);
    
    const [rawShifts, setRawShifts] = useState<FetchedShiftData[]>([]);
    const [patterns, setPatterns] = useState<FetchedPatternData[]>([]);
    const [events, setEvents] = useState<EventInput[]>([]);
    
    const [clients, setClients] = useState<ClientData[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);

    const [tabIndex, setTabIndex] = useState(0); 
    const [targetMonth, setTargetMonth] = useState<string>(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
    
    const [shiftModalOpen, setShiftModalOpen] = useState(false);
    const [patternModalOpen, setPatternModalOpen] = useState(false);
    const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: c } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
            if (c) setClients(c);
            const { data: s } = await supabase.from('staffs').select('id, name').eq('organization_id', currentOrg.id);
            if (s) setStaffs(s);
        } catch (error) { 
            console.error(error); 
        }
    }, [currentOrg]);

    // 引数 isBackground を追加：D&Dや保存時は画面を白くせず裏で更新する
    const fetchData = useCallback(async (isBackground = false) => {
        if (!currentOrg) return;
        if (!isBackground) setInitialLoading(true);
        setIsFetching(true);
        
        try {
            const fetchedPatterns = await getShiftPatterns(currentOrg.id);
            setPatterns((fetchedPatterns as unknown as FetchedPatternData[]) || []);

            const start = new Date(); start.setMonth(start.getMonth() - 2);
            const end = new Date(); end.setMonth(end.getMonth() + 3);
            const fetchedShifts = await getShifts(currentOrg.id, start.toISOString(), end.toISOString());
            const typedShifts = (fetchedShifts as unknown as FetchedShiftData[]) || [];
            
            setRawShifts(typedShifts);
            setEvents(convertToCalendarEvents(typedShifts, false));
        } catch (error) { 
            console.error(error); 
            showToast('データの取得に失敗しました', 'error'); 
        } finally { 
            setInitialLoading(false); 
            setIsFetching(false);
        }
    }, [currentOrg, showToast]);

    useEffect(() => {
        if (!wsLoading && currentOrg) { fetchMasterData(); fetchData(); }
    }, [wsLoading, currentOrg, fetchMasterData, fetchData]);

    const handleSaveShift = async (payload: ShiftPayload, shiftId?: string) => {
        try {
            if (shiftId) await updateShift(shiftId, payload);
            else await createShift(payload);
            showToast('保存しました'); 
            fetchData(true); // 裏側でカレンダーを更新（表示月は維持される）
        } catch(error) { 
            console.error(error);
            showToast('保存に失敗しました', 'error'); 
        }
    };

    const handleToggleCancel = async (shiftId: string, isCancel: boolean, reason: string) => {
        try {
            await toggleCancelShift(shiftId, isCancel, reason);
            showToast(isCancel ? 'お休みにしました' : '復元しました'); 
            fetchData(true);
        } catch(error) {
            console.error(error);
            showToast('変更に失敗しました', 'error'); 
        }
    };

    const handleEventChange = async (info: EventDropArg | EventResizeDoneArg) => {
        const shiftId = info.event.extendedProps.shiftId;
        const start = info.event.start?.toISOString() || '';
        const end = info.event.end ? info.event.end.toISOString() : new Date(info.event.start!.getTime() + 3600000).toISOString();
        try {
            await updateShiftTimeOnly(shiftId, start, end);
            showToast('時間を変更しました'); 
            fetchData(true); // D&D成功時も裏側でデータ同期を行う
        } catch (error) { 
            console.error(error);
            info.revert(); 
            showToast('変更に失敗しました', 'error'); 
        }
    };

    const handleSavePattern = async (payload: ShiftPatternPayload) => {
        try { await createShiftPattern(payload); showToast('ひな形を登録しました'); fetchData(true); } 
        catch(error) { console.error(error); showToast('登録に失敗しました', 'error'); }
    };

    const handleDeletePattern = async (id: string) => {
        if (!confirm('このひな形を削除しますか？\n（※すでに展開済みのカレンダー上のシフトは消えません）')) return;
        try { await deleteShiftPattern(id); showToast('削除しました'); fetchData(true); } 
        catch(error) { console.error(error); showToast('削除に失敗しました', 'error'); }
    };

    const handleGenerate = async () => {
        if (!currentOrg) return;
        if (!confirm(`${targetMonth}月分のシフトをひな形から自動生成しますか？\n（※すでに手入力したシフトには影響しません）`)) return;
        setGenerating(true);
        try {
            const res = await generateShiftsForMonth(currentOrg.id, targetMonth);
            showToast(`カレンダーに ${res.count} 件のシフトを自動作成しました！`, 'success');
            fetchData(true);
            setTabIndex(1); 
        } catch(error) { 
            console.error(error);
            showToast('自動生成に失敗しました', 'error'); 
        } finally { setGenerating(false); }
    };

    const formatRule = (rrule: string) => {
        let desc = '';
        if (rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
        else if (rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';
        
        const intervalMatch = rrule.match(/INTERVAL=([0-9]+)/);
        if (intervalMatch && intervalMatch[1] !== '1') desc = `${intervalMatch[1]}週間に1回 `;

        const daysMap: Record<string, string> = { 'MO':'月', 'TU':'火', 'WE':'水', 'TH':'木', 'FR':'金', 'SA':'土', 'SU':'日' };
        const match = rrule.match(/BYDAY=([^;]+)/);
        if (match) {
            const days = match[1].split(',').map(d => {
                const num = d.replace(/[A-Z]/g, ''); const day = d.replace(/[0-9]/g, '');
                return (num ? `第${num}` : '') + (daysMap[day] || '');
            });
            desc += days.join(', ');
        }
        return desc;
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="h6" fontWeight="bold">全体シフト管理</Typography>
                    {tabIndex === 0 ? (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setPatternModalOpen(true)} sx={{ boxShadow: 'none' }}>ひな形を追加</Button>
                    ) : (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSelectedShift(null); setShiftModalOpen(true); }} sx={{ boxShadow: 'none' }}>単発シフトを追加</Button>
                    )}
                </Box>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="基本パターン(ひな形)" /><Tab label="カレンダー (D&Dで調整)" />
                </Tabs>
            </Box>
            
            <Box sx={{ position: 'relative', flexGrow: 1, p: 3, bgcolor: '#f5f5f5', overflowY: 'auto' }}>
                {initialLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                ) : (
                    <>
                        {/* 裏側でデータ更新中の時は、画面右上に小さくインジケーターを表示 */}
                        {isFetching && (
                            <Box sx={{ position: 'absolute', top: 20, right: 30, zIndex: 10 }}>
                                <CircularProgress size={20} />
                            </Box>
                        )}

                        {/* タブ切り替え時にコンポーネントを破棄せず、display: none で隠すことでカレンダーの「月」状態を維持する */}
                        <Box sx={{ display: tabIndex === 0 ? 'block' : 'none' }}>
                            <Paper variant="outlined" sx={{ p: 2, mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 2, bgcolor: '#F0F5FF', borderColor: '#D0E0FF' }}>
                                <Typography variant="body2">登録したひな形から、対象月のカレンダーにシフトを一括で実体化（展開）させます。</Typography>
                                <Stack direction="row" spacing={1}>
                                    <TextField type="month" size="small" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} sx={{ bgcolor: 'white' }} />
                                    <Button variant="contained" color="secondary" startIcon={<PlayArrowIcon />} onClick={handleGenerate} disabled={generating || patterns.length === 0} sx={{ boxShadow: 'none' }}>
                                        {generating ? '生成中...' : '対象月のカレンダーに一括展開'}
                                    </Button>
                                </Stack>
                            </Paper>

                            <Typography variant="subtitle1" fontWeight="bold" mb={2}>現在登録されているひな形</Typography>
                            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, mb: 4 }}>
                                <Table>
                                    <TableHead sx={{ bgcolor: '#fafafa' }}>
                                        <TableRow>
                                            <TableCell sx={{ fontWeight: 'bold' }}>利用者</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>担当スタッフ</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>時間</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>ロジック</TableCell>
                                            <TableCell align="center">操作</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {patterns.length === 0 ? <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: '#666' }}>ひな形がありません</TableCell></TableRow> : (
                                            patterns.map((p) => (
                                                <TableRow key={p.id} hover>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>{p.clients?.name}</TableCell>
                                                    <TableCell>{p.shift_pattern_staffs.map(s => s.staffs?.name).join(', ')}</TableCell>
                                                    <TableCell>{p.start_time.slice(0,5)} 〜 {p.end_time.slice(0,5)}</TableCell>
                                                    <TableCell><Chip label={formatRule(p.rrule)} size="small" color="primary" variant="outlined" /></TableCell>
                                                    <TableCell align="center">
                                                        <Tooltip title="削除"><IconButton size="small" color="error" onClick={() => handleDeletePattern(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>

                            <Typography variant="subtitle1" fontWeight="bold" mb={2}>展開済みの単発シフト一覧 (直近の予定)</Typography>
                            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
                                <Table>
                                    <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                                        <TableRow>
                                            <TableCell sx={{ fontWeight: 'bold' }}>利用者</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>担当スタッフ</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>時間</TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>状態</TableCell>
                                            <TableCell align="center" sx={{ fontWeight: 'bold' }}>編集</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {rawShifts.length === 0 ? (
                                            <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: '#666' }}>登録されているシフトはありません</TableCell></TableRow>
                                        ) : (
                                            rawShifts.slice(0, 50).map((shift) => (
                                                <TableRow key={shift.id} hover sx={{ opacity: shift.status === 'cancelled' ? 0.6 : 1 }}>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>{shift.clients?.name}</TableCell>
                                                    <TableCell>{shift.shift_staffs.map(s => s.staffs?.name).filter(Boolean).join(', ')}</TableCell>
                                                    <TableCell>{new Date(shift.start_at).toLocaleDateString()} {new Date(shift.start_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 〜 {new Date(shift.end_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</TableCell>
                                                    <TableCell><Chip label={shift.status === 'cancelled' ? '休' : '稼働'} size="small" color={shift.status === 'cancelled' ? 'default' : 'success'} /></TableCell>
                                                    <TableCell align="center">
                                                        <IconButton size="small" onClick={() => {
                                                            const shiftDataForModal: ShiftData = {
                                                                id: shift.id, client_id: shift.client_id, title: shift.title,
                                                                start_at: shift.start_at, end_at: shift.end_at, status: shift.status,
                                                                cancel_reason: shift.cancel_reason,
                                                                shift_staffs: shift.shift_staffs.map(s => ({ staff_id: s.staff_id }))
                                                            };
                                                            setSelectedShift(shiftDataForModal); setShiftModalOpen(true);
                                                        }}><EditIcon fontSize="small" /></IconButton>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>

                        <Box sx={{ display: tabIndex === 1 ? 'block' : 'none', height: '100%' }}>
                            <ShiftCalendarViewer 
                                ref={calendarRef} events={events} initialView="dayGridMonth" 
                                headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' }} 
                                selectable editable={true} 
                                onEventDrop={handleEventChange} onEventResize={handleEventChange} 
                                onDateSelect={(info) => { 
                                    setSelectedShift({
                                        id: '', client_id: '', title: '', start_at: info.startStr, end_at: info.endStr,
                                        status: 'published', cancel_reason: '', shift_staffs: []
                                    }); 
                                    setShiftModalOpen(true); 
                                }} 
                                onEventClick={(i) => { setSelectedShift(i.event.extendedProps.shiftData); setShiftModalOpen(true); }} 
                            />
                        </Box>
                    </>
                )}
            </Box>
            <ShiftFormModal open={shiftModalOpen} onClose={() => setShiftModalOpen(false)} onSave={handleSaveShift} onToggleCancel={handleToggleCancel} clients={clients} staffs={staffs} organizationId={currentOrg.id} initialData={selectedShift} />
            <ShiftPatternModal open={patternModalOpen} onClose={() => setPatternModalOpen(false)} onSave={handleSavePattern} clients={clients} staffs={staffs} organizationId={currentOrg.id} />
        </Box>
    );
}